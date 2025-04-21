import { Wallet } from "xrpl";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// XRPL network URLs
export const MAINNET_URL = "wss://xrplcluster.com";
export const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";

// DID prefix for XRPL
export const DID_PREFIX = "did:xrpl:";
