const { ethers } = require('hardhat');
const path = require('path');
const fs = require('fs');
const { Scalar } = require('ffjavascript');

const pathOutputJson = path.join(__dirname, './deploy_output.json');
const { expect } = require('chai');
const genesis = require("./genesis.json")

async function main() {
    const deployer = (await ethers.getSigners())[0];
    const networkIDMainnet = 0;

    /*
        Deployment MATIC
    */
    const maticTokenName = 'Matic Token';
    const maticTokenSymbol = 'MATIC';
    const maticTokenInitialBalance = ethers.utils.parseEther('20000000');

    const maticTokenFactory = await ethers.getContractFactory('ERC20PermitMock');
    const maticTokenContract = await maticTokenFactory.deploy(
        maticTokenName,
        maticTokenSymbol,
        deployer.address,
        maticTokenInitialBalance,
    );
    await maticTokenContract.deployed();

    /*
        Deployment Mock verifier
    */
    const VerifierRollupHelperFactory = await ethers.getContractFactory(
        'VerifierRollupHelperMock',
    );
    const verifierContract = await VerifierRollupHelperFactory.deploy();
    await verifierContract.deployed();

    /*
    *Deployment Global exit root manager
    */
    const precalculateBridgeAddress = await ethers.utils.getContractAddress(
        { from: deployer.address, nonce: (await ethers.provider.getTransactionCount(deployer.address)) + 1 },
    );

    const precalculatePoEAddress = await ethers.utils.getContractAddress(
        { from: deployer.address, nonce: (await ethers.provider.getTransactionCount(deployer.address)) + 2 },
    );
    const globalExitRootManagerFactory = await ethers.getContractFactory('GlobalExitRootManager');
    const globalExitRootManager = await globalExitRootManagerFactory.deploy(precalculatePoEAddress, precalculateBridgeAddress);
    await globalExitRootManager.deployed();

    console.log('#######################\n');
    console.log('globalExitRootManager deployed to:', globalExitRootManager.address);

    /*
     *Deployment Bridge
     */
    const BridgeFactory = await ethers.getContractFactory('BridgeMock');
    const bridgeContract = await BridgeFactory.deploy(networkIDMainnet, globalExitRootManager.address);
    await bridgeContract.deployed();
    expect(bridgeContract.address).to.be.equal(precalculateBridgeAddress);

    console.log('#######################\n');
    console.log('Bridge deployed to:', bridgeContract.address);

    /*
        Deploy proof of efficiency
    */
    // Check genesis file
    const genesisRootHex = genesis.root;

    console.log('\n#######################');
    console.log('##### Deployment Proof of Efficiency #####');
    console.log('#######################');
    console.log('deployer:', deployer.address);
    console.log('globalExitRootManagerAddress:', globalExitRootManager.address);
    console.log('maticTokenAddress:', maticTokenContract.address);
    console.log('verifierAddress:', verifierContract.address);
    console.log('genesisRoot:', genesisRootHex);

    const ProofOfEfficiencyFactory = await ethers.getContractFactory('ProofOfEfficiencyMock');
    const proofOfEfficiencyContract = await ProofOfEfficiencyFactory.deploy(
        globalExitRootManager.address,
        maticTokenContract.address,
        verifierContract.address,
        genesisRootHex,
    );
    await proofOfEfficiencyContract.deployed();
    expect(proofOfEfficiencyContract.address).to.be.equal(precalculatePoEAddress);

    console.log('#######################\n');
    console.log('Proof of Efficiency deployed to:', proofOfEfficiencyContract.address);

    const deploymentBlockNumber = (await proofOfEfficiencyContract.deployTransaction.wait()).blockNumber;
    const defaultChainID = await proofOfEfficiencyContract.DEFAULT_CHAIN_ID();

    console.log('\n#######################');
    console.log('#####    Checks    #####');
    console.log('#######################');
    console.log('globalExitRootManagerAddress:', await proofOfEfficiencyContract.globalExitRootManager());
    console.log('maticTokenAddress:', await proofOfEfficiencyContract.matic());
    console.log('verifierMockAddress:', await proofOfEfficiencyContract.rollupVerifier());
    console.log('genesiRoot:', await proofOfEfficiencyContract.currentStateRoot());
    console.log('DEFAULT_CHAIN_ID:', defaultChainID);

    // calculate address and private Keys:
    DEFAULT_MNEMONIC = "test test test test test test test test test test test junk";
    const menmonic = process.env.MNEMONIC || DEFAULT_MNEMONIC
    const defaultAccountsJson = 20;
    const accountsArray = [];
    for (let i = 0; i < defaultAccountsJson; i++) {
        const path = `m/44'/60'/0'/0/${i}`
        const wallet = ethers.Wallet.fromMnemonic(menmonic, path);
        accountsArray.push({
            address: wallet.address,
            pvtKey: wallet.privateKey
        });
    }

    const outputJson = {
        proofOfEfficiencyAddress: proofOfEfficiencyContract.address,
        bridgeAddress: bridgeContract.address,
        globalExitRootManagerAddress: globalExitRootManager.address,
        maticTokenAddress: maticTokenContract.address,
        verifierMockAddress: verifierContract.address,
        deployerAddress: deployer.address,
        deploymentBlockNumber,
        genesisRoot: genesisRootHex,
    };
    fs.writeFileSync(pathOutputJson, JSON.stringify(outputJson, null, 1));

    // Test
    expect(await proofOfEfficiencyContract.matic()).to.equal(maticTokenContract.address);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});