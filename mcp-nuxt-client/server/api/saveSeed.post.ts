import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { xrplSeed, username } = body;

    if (!xrplSeed || !username) {
      return createError({
        statusCode: 400,
        statusMessage: 'Missing required fields: xrplSeed or username',
      });
    }

    // Path to .env file (at project root)
    const envPath = join(process.cwd(), '.env');
    
    // Read existing .env file if it exists
    let envContent = '';
    try {
      envContent = await readFile(envPath, 'utf-8');
    } catch (error) {
      // File doesn't exist, that's okay, we'll create it
      console.log('Creating new .env file');
    }

    // Check if XRPL_SEED is already defined
    const seedRegex = new RegExp(`^XRPL_SEED_${username.toUpperCase()}=.*$`, 'm');
    
    if (seedRegex.test(envContent)) {
      // Update existing XRPL_SEED
      envContent = envContent.replace(
        seedRegex,
        `XRPL_SEED_${username.toUpperCase()}="${xrplSeed}"`
      );
    } else {
      // Add XRPL_SEED to .env
      envContent += `\nXRPL_SEED_${username.toUpperCase()}="${xrplSeed}"\n`;
    }

    // Write to .env file
    await writeFile(envPath, envContent);

    console.log(`XRPL seed for ${username} saved to .env file`);
    
    return {
      success: true,
      message: 'XRPL seed saved to environment variables',
    };
  } catch (error: any) {
    console.error('Error saving XRPL seed:', error);
    
    return createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to save XRPL seed',
    });
  }
}); 