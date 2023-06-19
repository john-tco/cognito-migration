import { CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider';
import { Client } from 'pg';
import { COGNITO_ACCESS_KEY, COGNITO_SECRET, USER_SERVICE, APPLICANT_SERVICE } from './secrets';

const cognitoClient = new CognitoIdentityProvider({
  credentials: {
    secretAccessKey: COGNITO_SECRET,
    accessKeyId: COGNITO_ACCESS_KEY,
  },
});

const pgUserServiceClient = new Client({
  user: USER_SERVICE.USER,
  password: USER_SERVICE.PASSWORD,
  port: USER_SERVICE.PORT,
  database: USER_SERVICE.DATABASE,
  host: USER_SERVICE.HOST,
});

const pgApplicantApplyClient = new Client({
  user: APPLICANT_SERVICE.USER,
  password: APPLICANT_SERVICE.PASSWORD,
  port: APPLICANT_SERVICE.PORT,
  database: APPLICANT_SERVICE.DATABASE,
  host: APPLICANT_SERVICE.HOST,
});

export {
  pgApplicantApplyClient, pgUserServiceClient, cognitoClient
}