import { GraphQLError } from 'graphql';
import { Cache, GQtyError, prepass, type QueryPayload } from '../src';
import { $meta } from '../src/Accessor';
import { fetchSelections } from '../src/Client/resolveSelections';
import { updateCaches } from '../src/Client/updateCaches';
import { Selection } from '../src/Selection';
import { createTestClient } from './utils';

describe('core#resolve', () => {
  describe('fetchPolicy', () => {
    it('default', async () => {
      const {
        resolve,
        schema: { query },
      } = await createTestClient(undefined, undefined, undefined, {
        cache: new Cache(undefined, { maxAge: 50 }),
      });

      await expect(
        resolve(({ query }) => query.nFetchCalls, { cachePolicy: 'default' })
      ).resolves.toBe(1);

      await expect(
        resolve(({ query }) => query.nFetchCalls, { cachePolicy: 'default' })
      ).resolves.toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 150));

      let promise: Promise<unknown> | undefined;
      resolve(({ query }) => query.nFetchCalls, {
        awaitsFetch: false,
        cachePolicy: 'default',
        onFetch(p) {
          promise = p;
        },
      });
      expect(query.nFetchCalls).toBe(1);
      await promise;
      expect(query.nFetchCalls).toBe(2);
    });

    it('force-cache', async () => {
      const {
        resolve,
        schema: { query },
      } = await createTestClient(undefined, undefined, undefined, {
        cache: new Cache(undefined, { maxAge: 50, staleWhileRevalidate: 0 }),
      });

      await expect(
        resolve(
          ({ query }) => {
            query.nFetchCalls;
            return query.hello;
          },
          { cachePolicy: 'default' }
        )
      ).resolves.toBe('hello world');
      expect(query.nFetchCalls).toBe(1);

      await expect(
        resolve(
          ({ query }) => {
            query.nFetchCalls;
            return query.hello;
          },
          { cachePolicy: 'force-cache' }
        )
      ).resolves.toBe('hello world');
      expect(query.nFetchCalls).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(query.hello).toBe('hello world');
      await expect(
        resolve(
          ({ query }) => {
            query.nFetchCalls;
            return query.hello;
          },
          { cachePolicy: 'force-cache' }
        )
      ).resolves.toBe('hello world');
      expect(query.nFetchCalls).toBe(2);
    });

    it('no-cache', async () => {
      const { resolve } = await createTestClient(
        undefined,
        undefined,
        undefined,
        {
          cache: new Cache(undefined, {
            maxAge: Infinity,
            staleWhileRevalidate: 0,
          }),
        }
      );

      await expect(
        resolve(({ query }) => query.nFetchCalls, { cachePolicy: 'default' })
      ).resolves.toBe(1);

      await expect(
        resolve(({ query }) => query.nFetchCalls, { cachePolicy: 'no-cache' })
      ).resolves.toBe(2);

      await expect(
        resolve(({ query }) => query.nFetchCalls, { cachePolicy: 'default' })
      ).resolves.toBe(2);
    });

    it('no-store', async () => {
      const {
        resolve,
        schema: { query },
      } = await createTestClient(undefined, undefined, undefined, {
        cache: new Cache(undefined, {
          maxAge: Infinity,
          staleWhileRevalidate: 0,
        }),
      });

      await expect(
        resolve(({ query }) => query.hello, { cachePolicy: 'no-store' })
      ).resolves.toBe('hello world');

      expect(query.hello).toBeUndefined();
    });

    /**
     * Due to the random nature of GC, this test is especially flaky when
     * running concurrently with other tests. Skipping this by default.
     */
    xit('only-if-cached', async () => {
      const { resolve } = await createTestClient(
        undefined,
        undefined,
        undefined,
        {
          cache: new Cache(undefined, {
            maxAge: 0,
            staleWhileRevalidate: 0,
          }),
        }
      );

      await expect(() =>
        resolve(({ query }) => query.hello, { cachePolicy: 'only-if-cached' })
      ).rejects.toThrow(new TypeError('Failed to fetch'));

      await expect(resolve(({ query }) => query.hello)).resolves.toBe(
        'hello world'
      );

      await expect(
        resolve(({ query }) => query.hello, { cachePolicy: 'only-if-cached' })
      ).resolves.toBe('hello world');
    });
  });

  describe('Unreachable sub-selections', () => {
    it('should retain previous sub-selections on caches with empty arrays', async () => {
      const { createResolver } =
        // We cannot seed the cache with empty arrays because previous
        // selections are required to work.
        // { cache: new Cache({ query: { dogs: [] } }) },
        await createTestClient();

      const {
        accessor: { query },
        context,
        resolve,
        selections,
      } = createResolver();

      // 1. Make selections into dogs
      query.dogs.map((dog) => dog.bark({ times: 1 }));

      // 2. Ensure selections made
      expect([...selections].map((v) => v.cacheKeys.join('.')))
        .toMatchInlineSnapshot(`
               [
                 "query.dogs.__typename",
                 "query.dogs.id",
                 "query.dogs.a10168",
               ]
            `);

      // 3. resolve()
      await expect(resolve()).resolves.toMatchInlineSnapshot(`
               [
                 {
                   "data": {
                     "dogs": [
                       {
                         "__typename": "Dog",
                         "a10168": "arf!",
                         "id": "1",
                       },
                       {
                         "__typename": "Dog",
                         "a10168": "arf!",
                         "id": "2",
                       },
                     ],
                   },
                   "extensions": {
                     "hash": "a4049161dd3fbeed6f5c5658ae5aeb067002147bed201698119cf6fa3c93f6f8d",
                     "type": "query",
                   },
                 },
               ]
            `);

      // 4. Make selections again
      query.dogs = [];
      query.dogs.map((dog) => dog.bark({ times: 2 }));

      // 5. Expect previous sub-selections
      expect([...selections].map((v) => v.cacheKeys.join('.')))
        .toMatchInlineSnapshot(`
               [
                 "query.dogs.__typename",
                 "query.dogs.id",
                 "query.dogs.a10168",
               ]
            `);

      await expect(resolve()).resolves.toMatchInlineSnapshot(`undefined`);

      // 6. Ensure previous selections of no more than the last 1 fetch is reused.
      context.cache.clear();
      selections.clear();

      query.dogs.map((dog) => dog.bark({ times: 3 }));

      expect([...selections].map((v) => v.cacheKeys.join('.')))
        .toMatchInlineSnapshot(`
               [
                 "query.dogs.__typename",
                 "query.dogs.id",
                 "query.dogs.a516ab",
               ]
            `);

      await expect(resolve()).resolves.toMatchInlineSnapshot(`
               [
                 {
                   "data": {
                     "dogs": [
                       {
                         "__typename": "Dog",
                         "a516ab": "arf!arf!arf!",
                         "id": "1",
                       },
                       {
                         "__typename": "Dog",
                         "a516ab": "arf!arf!arf!",
                         "id": "2",
                       },
                     ],
                   },
                   "extensions": {
                     "hash": "a559a7f6482e7959e433f04f7274247f7cf5661540c3af47424ee1446027a816",
                     "type": "query",
                   },
                 },
               ]
            `);
    });

    it('should retain previous sub-selections on caches with null objects', async () => {
      const { createResolver } =
        // We cannot seed the cache with empty arrays because previous
        // selections are required to work.
        // { cache: new Cache({ query: { dogs: [] } }) },
        await createTestClient();

      const {
        accessor: { query },
        context,
        resolve,
        selections,
      } = createResolver();

      // 1. Select something non-null
      query.human({ name: 'John Doe' }).echo({ input: 'Now you see me...' });

      // 2. Ensure selections made
      expect([...selections].map((v) => v.cacheKeys.join('.')))
        .toMatchInlineSnapshot(`
         [
           "query.a6c916.__typename",
           "query.a6c916.id",
           "query.a6c916.e61179",
         ]
        `);

      // 3. resolve()
      await expect(resolve()).resolves.toMatchInlineSnapshot(`
         [
           {
             "data": {
               "a6c916": {
                 "__typename": "Human",
                 "e61179": "Now you see me...",
                 "id": "1",
               },
             },
             "extensions": {
               "hash": "a10b43bf9c52ee5bbc996198f56cc4f89f203199bfb6ad6f13b1082a5bcc1eae7",
               "type": "query",
             },
           },
         ]
        `);

      // 4. Select a null object
      query.human({ name: 'John Cena' }).echo({ input: "Now you don't!" });

      // 5. Expect sub-selections
      expect([...selections].map((v) => v.cacheKeys.join('.')))
        .toMatchInlineSnapshot(`
        [
          "query.a1cda9.__typename",
          "query.a1cda9.id",
          "query.a1cda9.a2ce8c",
        ]
      `);

      await expect(resolve()).resolves.toMatchInlineSnapshot(`
        [
          {
            "data": {
              "a1cda9": null,
            },
            "extensions": {
              "hash": "b9ae5a3dfdf2c9949d51bdf555c8eecc4c4c091d5d11cf0734853c4ba10bdd34",
              "type": "query",
            },
          },
        ]
      `);

      // 6. Ensure previous selections of no more than the last 1 fetch is reused.
      context.cache.clear();

      query.human({ name: 'Jane Doe' }).echo({ input: 'I am Jane.' });

      expect([...selections].map((v) => v.cacheKeys.join('.')))
        .toMatchInlineSnapshot(`
        [
          "query.a7816d.__typename",
          "query.a7816d.id",
          "query.a7816d.a0564a",
        ]
      `);

      await expect(resolve()).resolves.toMatchInlineSnapshot(`
        [
          {
            "data": {
              "a7816d": {
                "__typename": "Human",
                "a0564a": "I am Jane.",
                "id": "2",
              },
            },
            "extensions": {
              "hash": "a9df6d7b05fcef74f68db84388ccac8b33b9b3766e859e764b0e626741628bcd2",
              "type": "query",
            },
          },
        ]
      `);
    });
  });

  it('mutations', async () => {
    const { resolve } = await createTestClient();

    const name = `John Doe ${Date.now()}`;

    const data = await resolve(({ mutation }) => {
      const human = mutation.humanMutation({ nameArg: name });

      return human.name;
    });

    expect(data).toBe(name);
  });

  it('subscriptions', async () => {
    const { resolve } = await createTestClient(undefined, undefined, {
      subscriptions: true,
    });

    const subPromise = resolve(
      ({ subscription }) => subscription.newNotification
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    await resolve(({ mutation }) =>
      mutation.sendNotification({ message: 'hello world' })
    );

    const data = await subPromise;

    expect(data).toEqual('hello world');
  });

  it('handles errors', async () => {
    const { resolve } = await createTestClient();

    await expect(
      resolve(({ query }) => {
        query.throw;
        query.throw2;
      })
    ).rejects.toMatchObject(
      GQtyError.fromGraphQLErrors([
        new GraphQLError('expected error'),
        new GraphQLError('expected error 2'),
      ])
    );
  });

  it('passes on query extensions', async () => {
    const fetchHistory: QueryPayload[] = [];
    const { resolve } = await createTestClient(undefined, (payload) => {
      fetchHistory.push(payload);
      return {};
    });

    await resolve(({ query }) => query.hello, { extensions: { foo: 'bar' } });

    expect(fetchHistory[0].extensions).toMatchObject({ foo: 'bar' });
  });
});

describe('compat', () => {
  test('resolved', async () => {
    const { query, resolved } = await createTestClient();

    expect(typeof query).toBe('object');

    await resolved(() => {
      return query.hello;
    }).then((value) => {
      expect(value).toBe('hello world');
    });
  });

  test('resolved with onCacheData', async () => {
    const { query, resolved } = await createTestClient();

    expect(typeof query).toBe('object');

    await expect(resolved(() => query.hello)).resolves.toBe('hello world');

    const onCacheData = jest
      .fn()
      .mockImplementation((data: string): boolean => {
        expect(data).toBe('hello world');

        return true;
      });

    await expect(
      resolved(() => query.hello, { refetch: true, onCacheData })
    ).resolves.toBe('hello world');

    expect(onCacheData).toHaveBeenCalledTimes(1);

    const onCacheData2 = jest
      .fn()
      .mockImplementation((data: string): boolean => {
        expect(data).toBe('hello world');

        return false;
      });

    await expect(
      resolved(() => query.hello, { refetch: true, onCacheData: onCacheData2 })
    ).resolves.toBe('hello world');

    expect(onCacheData2).toHaveBeenCalledTimes(1);
  });

  test('resolved with operationName', async () => {
    const fetchHistory: string[] = [];
    const { query, resolved } = await createTestClient(
      undefined,
      async ({ query }) => {
        fetchHistory.push(query);
        return {};
      }
    );

    await Promise.all([
      resolved(() => query.hello, { operationName: 'TestQueryA' }),
      resolved(() => query.hello, { operationName: 'TestQueryB' }),
    ]);

    expect(fetchHistory).toEqual(
      expect.arrayContaining([
        'query TestQueryA{hello}',
        'query TestQueryB{hello}',
      ])
    );
  });

  test('resolved with unions', async () => {
    const { query, resolved, queries } = await createTestClient();

    await Promise.all([
      resolved(() => {
        return prepass(query.union({ type: 'A' }).$on, 'A.a', 'B.b');
      }),
    ]);

    expect(queries).toMatchObject(
      expect.arrayContaining([
        expect.objectContaining({
          query: expect.stringContaining('...on A{a id}...on B{b id}'),
        }),
      ])
    );
  });

  test('inlineResolved with operationName', async () => {
    const { query, mutation, inlineResolved, queries } =
      await createTestClient();

    await Promise.all([
      inlineResolved(() => query.human({ name: 'John' }).__typename, {
        operationName: 'TestQueryA',
      }),
      inlineResolved(
        () => mutation.humanMutation({ nameArg: 'Jane' }).__typename,
        { operationName: 'TestMutation' }
      ),
      inlineResolved(() => query.hello, {
        operationName: 'TestQueryB',
      }),
    ]);

    expect(queries.map(({ query }) => query)).toMatchInlineSnapshot(`
      [
        "query TestQueryA($a860ed:String){a1c0de:human(name:$a860ed){__typename}}",
        "mutation TestMutation($de937b:String!){eed53f:humanMutation(nameArg:$de937b){__typename}}",
        "query TestQueryB{hello}",
      ]
    `);
  });

  describe('resolved cache options', () => {
    test('refetch', async () => {
      const { query, resolved } = await createTestClient(
        undefined,
        undefined,
        undefined,
        { cache: new Cache(undefined, { maxAge: Infinity }) }
      );
      const resolveFn = () => {
        const human = query.human({
          name: 'a',
        });
        return {
          name: human.name,
          nFetchCalls: query.nFetchCalls,
        };
      };

      {
        const data = await resolved(resolveFn);

        expect(data.name).toBe('a');
        expect(data.nFetchCalls).toBe(1);
      }

      {
        const data = await resolved(resolveFn);

        expect(data.name).toBe('a');
        expect(data.nFetchCalls).toBe(1);
      }

      {
        const data = await resolved(resolveFn, { refetch: true });

        expect(data.name).toBe('a');
        expect(data.nFetchCalls).toBe(2);
      }
    });

    test('noCache', async () => {
      const { query, resolved } = await createTestClient(
        undefined,
        undefined,
        undefined,
        { cache: new Cache(undefined, { maxAge: Infinity }) }
      );
      const resolveFn = () => {
        const human = query.human({
          name: 'a',
        });
        return {
          name: human.name,
          nFetchCalls: query.nFetchCalls,
        };
      };

      {
        const data = await resolved(resolveFn);

        expect(data.name).toBe('a');
        expect(data.nFetchCalls).toBe(1);
      }

      {
        const data = await resolved(resolveFn, { noCache: true });

        expect(data.name).toBe('a');
        expect(data.nFetchCalls).toBe(2);
      }

      {
        const data = await resolved(resolveFn);

        expect(data.name).toBe('a');
        expect(data.nFetchCalls).toBe(1);
      }
    });
  });

  describe('resolved fetch options', () => {
    test('fetch options are passed to query fetcher', async () => {
      expect.assertions(2);

      const { resolved, query } = await createTestClient(
        undefined,
        async ({ query, variables }, fetchOptions) => {
          expect({ query, variables, fetchOptions }).toStrictEqual({
            fetchOptions: {
              mode: 'cors',
              credentials: 'include',
            },
            query: 'query{hello}',
            variables: undefined,
          });
          return {
            data: {
              hello: 'Hello World',
            },
          };
        }
      );

      expect(
        await resolved(
          () => {
            return query.hello;
          },
          {
            fetchOptions: {
              mode: 'cors',
              credentials: 'include',
            },
          }
        )
      ).toBe('Hello World');
    });
  });

  describe('error handling', () => {
    test('resolved single throws', async () => {
      const { query, resolved } = await createTestClient();

      await resolved(
        () => {
          query.throw;
        },
        {
          retry: false,
        }
      )
        .then(() => {
          throw Error("Shouldn't reach here");
        })
        .catch((err) => {
          if (!(err instanceof Error)) throw Error('Incompatible error type');

          expect(err).toEqual(
            Object.assign(Error('expected error'), {
              locations: [{ line: 1, column: 7 }],
              path: ['throw'],
            })
          );
        });
    });

    test('resolved multiple throws, with shorter error for production', async () => {
      const { query, resolved } = await createTestClient();

      const prevProcessEnv = process.env.NODE_ENV;

      try {
        await resolved(
          () => {
            query.throw;
            query.throw2;
          },
          {
            retry: false,
          }
        )
          .then(() => {
            throw Error("Shouldn't reach here");
          })
          .catch((err) => {
            if (!(err instanceof Error)) throw Error('Incompatible error type');

            expect(err).toEqual(
              Object.assign(
                Error('GraphQL Errors, please check .graphQLErrors property'),
                {
                  errors: [
                    {
                      message: 'expected error',
                      locations: [{ line: 1, column: 7 }],
                      path: ['throw'],
                    },
                    {
                      message: 'expected error 2',
                      locations: [{ line: 1, column: 13 }],
                      path: ['throw2'],
                    },
                  ],
                }
              )
            );
          });

        process.env.NODE_ENV = 'production';

        await resolved(
          () => {
            query.throw;
            query.throw2;
          },
          {
            noCache: true,
            retry: false,
          }
        )
          .then(() => {
            throw Error("Shouldn't reach here");
          })
          .catch((err) => {
            if (!(err instanceof Error)) throw Error('Incompatible error type');

            expect(err).toEqual(
              Object.assign(Error('GraphQL Errors'), {
                errors: [
                  {
                    message: 'expected error',
                    locations: [{ line: 1, column: 7 }],
                    path: ['throw'],
                  },
                  {
                    message: 'expected error 2',
                    locations: [{ line: 1, column: 13 }],
                    path: ['throw2'],
                  },
                ],
              })
            );
          });
      } finally {
        process.env.NODE_ENV = prevProcessEnv;
      }
    });

    test('network error', async () => {
      const { query, resolved } = await createTestClient(undefined, () => {
        throw Error('expected network error');
      });

      try {
        await resolved(() => query.hello);

        throw Error("shouldn't reach here");
      } catch (err: any) {
        expect(err.message).toBe('expected network error');
      }
    });

    test('unexpected network error type', async () => {
      const { query, resolved } = await createTestClient(undefined, () => {
        throw 12345;
      });

      try {
        await resolved(() => query.hello);

        throw Error("shouldn't reach here");
      } catch (err) {
        expect(err).toStrictEqual(GQtyError.create(12345));
      }
    });
  });

  describe('mutation', () => {
    test('mutation usage', async () => {
      const { mutation, resolved } = await createTestClient();

      const data = await resolved(() => {
        return mutation.sendNotification({
          message: 'hello world',
        });
      });

      expect(data).toBe(true);
    });
  });

  describe('custom query fetcher', () => {
    test('empty data', async () => {
      const { query, resolved } = await createTestClient(
        undefined,
        async (_query, _variables) => ({})
      );

      const data = await resolved(() => {
        return query.hello;
      });
      expect(data).toBe(undefined);
    });
  });

  describe('fetchSelections', () => {
    test('works with included cache', async () => {
      const {
        schema: { query },
      } = await createTestClient();

      const cache = $meta(query)?.context.cache!;

      await fetchSelections(
        new Set([Selection.createRoot('query').getChild('hello')]),
        {
          cache,
          fetchOptions: {
            fetcher: async () => ({ data: { hello: 'hello world' } }),
          },
        }
      ).then((results) => {
        updateCaches(results, [cache], { skipNotify: false });
      });

      expect(cache.toJSON()).toMatchObject({
        query: {
          hello: 'hello world',
        },
      });
    });
  });
});
