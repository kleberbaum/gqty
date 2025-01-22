import { app, getContext } from '@getcronit/pylon';
import { GraphQLError } from 'graphql';

// Gqty
import { resolve } from './clients/iam/index';
import {
  QueryTypes,
  MutationTypes,
  convertParamsToArgs,
} from './clients/iam/schema.generated';

// Recursivly analyse the response object to get the whole object
const getAll = (obj) => {
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      getAll(obj[key]);
    } else {
      console.log(obj[key]);
    }
  }
};

export const graphql = {
  Query: {
    getIsUnique: async (
      ...params: QueryTypes['getIsUnique']['params']
    ): Promise<QueryTypes['getIsUnique']['return']> => {
      const context = getContext();
      const authorizationHeader = context.req.header('Authorization');

      const args = convertParamsToArgs.Query.getIsUnique(params);

      const isUnique = await resolve(
        ({ query }) => {
          const objectGql = query.getIsUnique(args);

          // Just a temproary workaround to get the whole object
          // should be replaced with just the thing that are requested
          // from pylons graphql api.
          getAll(objectGql);

          return objectGql;
        },
        {
          extensions: {
            authToken: authorizationHeader,
          },
          cachePolicy: 'no-store',
        }
      );

      // if (errors) {
      //   throw new GraphQLError(errors[0].message, {
      //     extensions: errors[0].extensions,
      //   });
      // }

      return isUnique;
    },
  },
  Mutation: {
    userCreate: async (...params: MutationTypes['userCreate']['params']) => {
      const context = getContext();
      const authorizationHeader = context.req.header('Authorization');

      let args = convertParamsToArgs.Mutation.userCreate(params);

      const data = await resolve(
        ({ mutation }) => {
          const response = mutation.userCreate(args);

          // Just a temproary workaround to get the whole object
          // should be replaced with just the thing that are requested
          // from pylons graphql api.
          getAll(response);

          return response;
        },
        {
          extensions: {
            authToken: authorizationHeader,
          },
          cachePolicy: 'no-store',
        }
      );

      return data;
    },
  },
};

export default app;
