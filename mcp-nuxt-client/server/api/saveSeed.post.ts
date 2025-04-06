import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { xrplSeed, username } = body;

    if (!xrplSeed) {
      return createError({
        statusCode: 400,
        statusMessage: 'Missing required field: xrplSeed',
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

    // Check if SEED is already defined
    const seedRegex = new RegExp(`^SEED=.*$`, 'm');
    
    if (seedRegex.test(envContent)) {
      // Update existing SEED
      envContent = envContent.replace(
        seedRegex,
        `SEED="${xrplSeed}"`
      );
    } else {
      // Add SEED to .env
      envContent += `\nXRPL_SEED=${xrplSeed}\n`;
    }

    // Write to .env file
    await writeFile(envPath, envContent);

    console.log(`Seed saved to .env file as SEED`);
    
    return {
      success: true,
      message: 'Seed saved to environment variables',
    };
  } catch (error: any) {
    console.error('Error saving seed:', error);
    
    return createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to save seed',
    });
  }
}); 