export interface RelevantCognitoData {
  hashedEmailAddress: string;
  dept: string;
  roles: string[];
  sub: string;
  phoneNumber: string;
};

export interface UserServiceData extends RelevantCognitoData {
  gap_user_id: string;
};

