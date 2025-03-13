# SOFA Protocol

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

SOFA Protocol is a decentralized finance(DeFi) protocol designed to empower secure and efficient interactions within a blockchain ecosystem. This repository contains the core smart contracts and scripts built using [Hardhat](https://hardhat.org/), along with supporting libraries and documentation.

## Table of Contents

- [Overview](#overview)
- [Audits](#audits)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Contributing](#contributing)
- [Connect With the Community](#connect-with-the-community)
- [License](#license)

## Overview

The SOFA protocols offer a new way to handle crypto by making transactions clear and safe. It lets you earn based on benefits without worrying about asset safety. All details are recorded transparently on the blockchain, supporting various products. Tokenized positions improve capital efficiency and can be used across DeFi and centralized platforms. Using ERC-1155 tokens saves on costs, and the system is designed to be sustainable and user-friendly.

For more details, please visit SOFA.org homepage and explore SOFA Documentation:

- [SOFA.org](https://www.sofa.org/)

- [SOFA Documentation](https://docs.sofa.org/)

## Audits

The SOFA protocols have been subjected to comprehensive and strict security audits conducted by several renowned independent organizations. For further details and insights, please refer to the full audit reports published by these organizations:

- [Code4rena(Zenith)](https://github.com/zenith-security/reports/blob/main/reports/Audit%20Report%20-%20Sofa%20%28May%202024%29.pdf)
- [Peckshield](https://github.com/peckshield/publications/blob/master/audit_reports/PeckShield-Audit-Report-Sofa-v1.0.pdf)
- [SigmaPrime](https://github.com/sigp/public-audits/blob/master/reports/sofa/review.pdf)
- [Automator audited by Code4rena(Zenith)](https://github.com/zenith-security/reports/blob/main/reports/Audit%20Report%20-%20Sofa%20Automator%28Oct%202024%29.pdf)
- [Automator2.0 audited by Code4rena(Zenith)](https://github.com/zenith-security/reports/blob/main/reports/Zenith%20Audit%20Report%20-%20Sofa%20Automator%202.0.pdf)
- [Automator2.0 & Dual Currency audited by yAudit](https://reports.electisec.tech/reports/01-2025-Sofa-Protocol)

## Getting Started

SOFA Protocol leverages Hardhat to streamline smart contract development, testing, and deployment. Our goal is to provide a modular, scalable, and secure framework that can integrate seamlessly with DeFi ecosystems.

### Prerequisites

Ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18.x or later)
- [npm](https://www.npmjs.com/)
- [Hardhat](https://hardhat.org/) (installed via npm)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/sofa-org/sofa-protocol.git
cd sofa-protocol
npm install
```

### Configuration

Set up .env file to set your configuration variables (e.g., network URLs, private keys) used in hardhat.config.ts for your development environment.

## Usage

### Compiling Contracts

Compile the smart contracts using Hardhat:

```bash
npx hardhat compile
```

### Running Tests

Run the test suite to ensure everything is working as expected:

```bash
npx hardhat test
```

## Contributing

Contributions are welcome. To contribute:

### Fork the repository

### Create a new branch

```bash
git checkout -b feature/your-feature-name
```

### Make your changes
Update files as needed.

### Add all your changes

```bash
git add .
```

### Commit your changes

```bash
git commit -m "Describe your changes"
```

### Push the branch to your fork

```bash
git push origin feature/your-feature-name
```

### Submit a Pull Request on GitHub for review.
Please ensure that your contributions follow the existing style and structure, and that you test locally before submitting a pull request.

## Connect With the Community

You can join the [Discord](https://discord.gg/sofaorg) to ask questions about the protocol or talk about SOFA with other peers.

## License
This project is licensed under the MIT License. 