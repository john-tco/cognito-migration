export interface RelevantCognitoData {
  hashedEmailAddress: string;
  dept: string;
  roles: string[];
  sub: string;
  encryptedEmailAddress: string;
};

export interface UserServiceData extends RelevantCognitoData {
  gap_user_id: string;
};

export interface Department  {
  id: string;
  name: string;
  ggis_id: string
}

export interface Role {
  id: string;
  name: string;
}