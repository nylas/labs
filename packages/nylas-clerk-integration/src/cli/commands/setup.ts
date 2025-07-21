import { Command } from "commander"
import { input, password, select } from "@inquirer/prompts"
import { createClerkClient } from "@clerk/backend"
import { handlePromise } from "../../lib/handle-promise.js"
import { chalk } from "../lib/chalk.js"
import type { NylasOAuthSettings } from "../types.js"

export const setupCommand = new Command("setup")
  .description("Setup Clerk OAuth application with Nylas provider")
  .option("--clerk-secret-key <key>", "Clerk secret key")
  .option("--nylas-client-id <id>", "Nylas client ID")
  .option("--nylas-client-secret <secret>", "Nylas client secret")
  .option("--redirect-url <url>", "OAuth redirect URL")
  .option("--environment <env>", "Environment (development|production)", "development")
  .action(async (options) => {
    console.log(chalk.blue("🔧 Setting up Clerk OAuth application with Nylas provider\n"))
    
    try {
      // Collect required information
      const config = await collectRequiredInfo(options)
      
      // Check for existing Nylas OAuth applications
      const existingApp = await checkExistingNylasOAuth(config.clerkSecretKey)
      
      let shouldCreate = true
      let shouldUpdate = false
      let existingAppId = null
      
      if (existingApp) {
        console.log(chalk.yellow(`\n⚠️  Found existing Nylas OAuth application: "${existingApp.name}"`))
        console.log(chalk.dim(`   Client ID: ${existingApp.clientId}`))
        console.log(chalk.dim(`   Created: ${new Date(existingApp.createdAt).toLocaleDateString()}\n`))
        
        const action = await select({
          message: "What would you like to do?",
          choices: [
            { name: "Update existing application", value: "update" },
            { name: "Create new application", value: "create" },
            { name: "Cancel", value: "cancel" }
          ]
        })
        
        if (action === "cancel") {
          console.log(chalk.yellow("Setup cancelled"))
          return
        }
        
        shouldUpdate = action === "update"
        shouldCreate = action === "create"
        existingAppId = existingApp.id
      }
      
             // Create or update OAuth application
       if (shouldCreate || shouldUpdate) {
         if (shouldUpdate) {
           console.log(chalk.yellow("\n⚠️  Update functionality will be available in a future version."))
           console.log(chalk.blue("For now, you can manually update the OAuth application in your Clerk Dashboard."))
           console.log(chalk.dim(`Application ID: ${existingAppId}`))
           return
         }
         
         const result = await createClerkOAuthApp(config)
         
         if (result.success) {
           console.log(chalk.green(`\n✅ Successfully created Clerk OAuth application!`))
           console.log(chalk.blue("\n📋 OAuth Application Details:"))
           console.log(chalk.dim(`   Name: ${result.data.name}`))
           console.log(chalk.dim(`   Client ID: ${result.data.clientId}`))
           console.log(chalk.dim(`   Scopes: ${result.data.scopes}`))
           console.log(chalk.dim(`   Redirect URIs: ${result.data.redirectUris?.join(", ") || result.data.callbackUrl}`))
           
           console.log(chalk.blue("\n🔐 Integration Instructions:"))
           console.log(chalk.dim("1. In your Clerk Dashboard, go to 'User & Authentication' > 'Social Connections'"))
           console.log(chalk.dim("2. Add 'Custom OAuth' provider"))
           console.log(chalk.dim(`3. Use the Client ID: ${result.data.clientId}`))
           console.log(chalk.dim("4. Configure the OAuth endpoints as needed"))
           
         } else {
           console.error(chalk.red(`\n❌ Failed to create OAuth application:`))
           console.error(chalk.red(`   ${result.error}`))
           process.exit(1)
         }
       }
      
    } catch (error) {
      console.error(chalk.red("\n❌ Setup failed:"))
      console.error(chalk.red(`   ${error instanceof Error ? error.message : String(error)}`))
      process.exit(1)
    }
  })

async function collectRequiredInfo(options: any): Promise<NylasOAuthSettings> {
  const config: Partial<NylasOAuthSettings> = {}
  
  // Clerk Secret Key
  if (options.clerkSecretKey) {
    config.clerkSecretKey = options.clerkSecretKey
  } else {
    config.clerkSecretKey = await password({
      message: "Enter your Clerk Secret Key:",
      mask: true,
      validate: (value) => {
        if (!value || !value.startsWith("sk_")) {
          return "Please enter a valid Clerk secret key (starts with 'sk_')"
        }
        return true
      }
    })
  }
  
  // Nylas Client ID
  if (options.nylasClientId) {
    config.nylasClientId = options.nylasClientId
  } else {
    config.nylasClientId = await input({
      message: "Enter your Nylas Client ID:",
      validate: (value) => {
        if (!value || value.length < 10) {
          return "Please enter a valid Nylas client ID"
        }
        return true
      }
    })
  }
  
  // Nylas Client Secret
  if (options.nylasClientSecret) {
    config.nylasClientSecret = options.nylasClientSecret
  } else {
    config.nylasClientSecret = await password({
      message: "Enter your Nylas Client Secret:",
      mask: true,
      validate: (value) => {
        if (!value || value.length < 10) {
          return "Please enter a valid Nylas client secret"
        }
        return true
      }
    })
  }
  
  // Redirect URL
  if (options.redirectUrl) {
    config.redirectUrl = options.redirectUrl
  } else {
    config.redirectUrl = await input({
      message: "Enter your OAuth redirect URL:",
      default: "http://localhost:3000/auth/callback",
      validate: (value) => {
        if (!value || !value.startsWith("http")) {
          return "Please enter a valid redirect URL"
        }
        return true
      }
    })
  }
  
  // Environment
  config.environment = options.environment || "development"
  
  return config as NylasOAuthSettings
}

async function checkExistingNylasOAuth(clerkSecretKey: string): Promise<any | null> {
  const clerkClient = createClerkClient({ secretKey: clerkSecretKey })
  
  const [error, result] = await handlePromise(
    clerkClient.oauthApplications.list({ limit: 100 })
  )
  
  if (error) {
    console.warn(chalk.yellow("⚠️  Could not check for existing OAuth applications"))
    return null
  }
  
  // Look for existing Nylas OAuth applications
  const existingNylasApp = result.data?.find((app: any) => 
    app.name?.toLowerCase().includes("nylas") || 
    app.name?.toLowerCase().includes("gmail") ||
    app.name?.toLowerCase().includes("google")
  )
  
  return existingNylasApp || null
}

async function createClerkOAuthApp(config: NylasOAuthSettings): Promise<{ success: boolean; data?: any; error?: string }> {
  const clerkClient = createClerkClient({ secretKey: config.clerkSecretKey })
  
  const [error, result] = await handlePromise(
    clerkClient.oauthApplications.create({
      name: "Nylas OAuth Provider",
      redirectUris: [config.redirectUrl],
      scopes: "profile email",
      public: false
    })
  )
  
  if (error) {
    return { success: false, error: error.message || "Failed to create OAuth application" }
  }
  
  return { success: true, data: result }
}

 