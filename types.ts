export interface RelevantCognitoData {
  email: string;
  dept: string;
  roles: string[];
  sub: string;
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