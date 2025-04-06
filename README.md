# XRP Ledger Model Context Protocol Server

A Model Context Protocol (MCP) server implementation providing tools for interacting with the XRP Ledger (XRPL). This server enables AI models to perform actions on the XRP Ledger network, including wallet management, transfers, token operations, and many other XRPL-specific features.

## Overview

This server integrates with the XRPL network to provide a wide range of operations as tools that can be used by AI models via the Model Context Protocol. It supports both mainnet and testnet, with a default focus on testnet for development safety.

## Features

The server provides the following categories of operations:

-   **Account Management**

    -   Connect to XRPL
    -   Get account information
    -   Delete account
    -   Set account properties
    -   Deposit preauthorization
    -   Set regular key

-   **XRP and Token Operations**

    -   Transfer XRP between accounts
    -   Get token metadata
    -   Check token balance
    -   Transfer tokens
    -   Approve token spending
    -   Token clawback

-   **NFT Operations**

    -   Mint NFTs
    -   View NFT metadata
    -   Verify NFT ownership
    -   Transfer NFTs
    -   Get NFT collections

-   **Decentralized Identifier (DID)**

    -   Create DID
    -   Resolve DID
    -   Update DID
    -   Deactivate DID

-   **AMM (Automated Market Maker) Operations**

    -   Create AMM
    -   Deposit to AMM
    -   Place bid on AMM
    -   Vote on AMM parameters
    -   Delete AMM
    -   Clawback assets from AMM

-   **Check Operations**

    -   Create check
    -   Cash check
    -   Cancel check

-   **Offer/DEX Operations**

    -   Create offer
    -   Cancel offer

-   **Oracle Operations**

    -   Set oracle data
    -   Delete oracle

-   **Payment Channels**

    -   Create payment channel
    -   Fund payment channel
    -   Claim from payment channel

-   **Escrow**

    -   Create escrow
    -   Finish escrow
    -   Cancel escrow

-   **Trustlines**

    -   Set trustline

-   **Ticketing**
    -   Create tickets

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/mcp-xrpl.git
cd mcp-xrpl/mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

Create a `.env` file in the project root with the following variables:

```
# Optional: XRPL wallet seed for automatic connection
# If not provided, you can connect using the connect-to-xrpl tool
DEFAULT_SEED=sEdVoKkRRF8RsNYZ689NDeMyrijiCbg  # Example - replace with your own or remove
```

## Usage

### Starting the Server

```bash
node build/index.js
```

This will start the MCP server on stdio, ready to accept commands from an MCP client.

### Automatic Connection

The server attempts to automatically connect to the XRPL testnet using the seed provided in the `.env` file. If no seed is provided or the connection fails, you can manually connect using the `connect-to-xrpl` tool.

### Using with an MCP Client

The server is designed to be used with MCP clients, such as AI models that support the Model Context Protocol. The client can use any of the provided tools to interact with the XRP Ledger.

## Available Tools

Here's a sample of the available tools:

| Tool Name                | Description                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `connect-to-xrpl`        | Connect to XRP Ledger using seed from .env or create a new wallet |
| `transfer-xrp`           | Transfer XRP between accounts                                     |
| `get-account-info`       | Get account information from the XRP Ledger                       |
| `get-token-metadata`     | Get token metadata (name, symbol, decimals, supply)               |
| `check-token-balance`    | Check token balance for an address                                |
| `transfer-token`         | Transfer tokens between addresses                                 |
| `approve-token-spending` | Establish trust line to approve token usage                       |
| `nft-mint`               | Create a non-fungible token on the XRP Ledger                     |
| `transfer-nft`           | Transfer NFT between addresses                                    |
| `create-did`             | Create a decentralized identifier (DID) for an XRPL account       |
| `amm-create`             | Create a new Automated Market Maker (AMM) on the XRP Ledger       |

## Safety and Network Usage

By default, most operations are performed on the XRPL testnet to ensure safety during development and testing. The `useTestnet` parameter can be set to `false` to use mainnet, but this should be done with caution.

## Development

### Project Structure

```
mcp-server/
├── src/
│   ├── core/                # Core utilities and services
│   │   ├── constants.ts     # XRPL network URLs and other constants
│   │   ├── state.ts         # State management for connected wallet
│   │   ├── utils.ts         # Helper functions
│   │   └── services/        # Service modules
│   ├── server/              # MCP server implementation
│   ├── transactions/        # XRPL transaction implementation
│   │   ├── token/           # Token-related transactions
│   │   ├── nft/             # NFT-related transactions
│   │   ├── did/             # DID-related transactions
│   │   ├── amm/             # AMM-related transactions
│   │   ├── check/           # Check-related transactions
│   │   ├── offer/           # Offer-related transactions
│   │   ├── oracle/          # Oracle-related transactions
│   │   ├── payment/         # Payment-related transactions
│   │   ├── escrow/          # Escrow-related transactions
│   │   └── trust/           # Trust line-related transactions
│   └── index.ts             # Entry point
├── build/                   # Compiled JavaScript output
├── package.json
├── package-lock.json
└── tsconfig.json
```

### Adding New Tools

To add a new tool:

1. Create a new TypeScript file in the appropriate directory under `src/transactions/`
2. Import the server from `server/server.js`
3. Define the tool using `server.tool()`
4. Import the tool in `src/index.ts`

## License

[MIT](LICENSE)

## Dependencies

-   [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk): MCP SDK
-   [`xrpl`](https://www.npmjs.com/package/xrpl): XRP Ledger JavaScript/TypeScript API
-   [`dotenv`](https://www.npmjs.com/package/dotenv): Environment variable management
-   [`zod`](https://www.npmjs.com/package/zod): TypeScript-first schema declaration and validation

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This software is provided for educational and development purposes only. Use it at your own risk. Always test thoroughly on the testnet before using on mainnet with real XRP.
