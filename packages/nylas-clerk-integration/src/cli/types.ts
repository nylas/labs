export interface NylasOAuthSettings {
  clerkSecretKey: string
  nylasClientId: string
  nylasClientSecret: string
  redirectUrl: string
  environment: "development" | "production"
}

export interface ClerkOAuthApplication {
  id: string
  name: string
  client_id: string
  client_secret: string
  public: boolean
  scopes: string[]
  callback_url: string
  authorize_url: string
  token_url: string
  user_info_url: string
}

export interface ConfigFile {
  settings: NylasOAuthSettings
  lastUpdated: string
} 