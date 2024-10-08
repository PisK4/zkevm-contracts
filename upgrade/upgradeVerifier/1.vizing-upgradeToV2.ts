/* eslint-disable no-await-in-loop, no-use-before-define, no-lonely-if */
/* eslint-disable no-console, no-inner-declarations, no-undef, import/no-unresolved */
import {expect} from "chai";
import path = require("path");
import fs = require("fs");

import * as dotenv from "dotenv";
dotenv.config({path: path.resolve(__dirname, "../../.env")});
import hre, {ethers, upgrades} from "hardhat";
import {PolygonZkEVM} from "../../typechain-types";
const {defaultAbiCoder} = require("@ethersproject/abi");
const {keccak256} = require("@ethersproject/keccak256");

const pathOutputJson = path.join(__dirname, "./upgrade_output.json");

// const deployParameters = require("./deploy_parameters.json");
const deployOutputParameters = require("./deploy_output.json");
const upgradeParameters = require("./upgrade_parameters.json");

async function main() {
    const attemptsDeployProxy = 20;

    upgrades.silenceWarnings();

    const currentBlock = await ethers.provider.getBlockNumber();

    console.log(`current block: ${currentBlock}`);

    if (currentBlock == 0) {
        throw new Error("current block is 0");
    }

    /*
     * Check upgrade parameters
     * Check that every necessary parameter is fullfilled
     */
    const mandatoryUpgradeParameters = ["realVerifier", "newForkID", "timelockDelay", "polTokenAddress"];

    for (const parameterName of mandatoryUpgradeParameters) {
        if (upgradeParameters[parameterName] === undefined || upgradeParameters[parameterName] === "") {
            throw new Error(`Missing parameter: ${parameterName}`);
        }
    }

    const {realVerifier, newForkID, timelockDelay, polTokenAddress} = upgradeParameters;
    const salt = upgradeParameters.timelockSalt || ethers.ZeroHash;

    /*
     * Check output parameters
     * Check that every necessary parameter is fullfilled
     */
    const mandatoryOutputParameters = [
        "polygonZkEVMBridgeAddress",
        "polygonZkEVMGlobalExitRootAddress",
        "cdkValidiumAddress",
        "timelockContractAddress",
    ];

    for (const parameterName of mandatoryOutputParameters) {
        if (deployOutputParameters[parameterName] === undefined || deployOutputParameters[parameterName] === "") {
            throw new Error(`Missing parameter: ${parameterName}`);
        }
    }

    const currentBridgeAddress = deployOutputParameters.polygonZkEVMBridgeAddress;
    const currentDataCommitteeAddress = deployOutputParameters.cdkDataCommitteeContract;
    const currentGlobalExitRootAddress = deployOutputParameters.polygonZkEVMGlobalExitRootAddress;
    const currentPolygonZkEVMAddress = deployOutputParameters.cdkValidiumAddress;
    const currentTimelockAddress = deployOutputParameters.timelockContractAddress;
    console.log(
        {currentBridgeAddress},
        {currentGlobalExitRootAddress},
        {currentPolygonZkEVMAddress},
        {currentTimelockAddress}
    );

    // Load onchain parameters
    // const polygonZkEVMFactory = await ethers.getContractFactory("PolygonZkEVM");
    const polygonZkEVMFactory = await ethers.getContractFactory("CDKValidium");
    const polygonZkEVMContract = (await polygonZkEVMFactory.attach(currentPolygonZkEVMAddress)) as PolygonZkEVM;

    const admin = await polygonZkEVMContract.admin();
    const trustedAggregator = await polygonZkEVMContract.trustedAggregator();
    const trustedAggregatorTimeout = await polygonZkEVMContract.trustedAggregatorTimeout();
    const pendingStateTimeout = await polygonZkEVMContract.pendingStateTimeout();
    const chainID = await polygonZkEVMContract.chainID();
    const emergencyCouncilAddress = await polygonZkEVMContract.owner();

    console.log(
        {admin},
        {trustedAggregator},
        {trustedAggregatorTimeout},
        {pendingStateTimeout},
        {chainID},
        {emergencyCouncilAddress}
    );

    // Load provider
    let currentProvider = ethers.provider;

    // Load deployer
    let deployer;
    // if (deployParameters.deployerPvtKey) {
    //     deployer = new ethers.Wallet(deployParameters.deployerPvtKey, currentProvider);
    // } else
    if (process.env.DEPLOYER_PRIVATE_KEY) {
        deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, currentProvider);
    } else if (process.env.MNEMONIC) {
        deployer = ethers.HDNodeWallet.fromMnemonic(
            ethers.Mnemonic.fromPhrase(process.env.MNEMONIC),
            "m/44'/60'/0'/0/0"
        ).connect(currentProvider);
    } else {
        [deployer] = await ethers.getSigners();
    }

    console.log("deploying with: ", deployer.address);

    const proxyAdminAddress = await upgrades.erc1967.getAdminAddress(currentPolygonZkEVMAddress as string);

    const proxyAdmin = await ethers.getContractAt(
        "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin",
        proxyAdminAddress
    );

    console.log("proxyAdmin: ", proxyAdmin.target);

    // Assert correct admin
    expect(deployOutputParameters.proxyAdminAddress).to.be.equal(proxyAdmin.target);

    expect(await proxyAdmin.getProxyAdmin(currentPolygonZkEVMAddress)).to.be.equal(proxyAdmin.target);
    expect(await proxyAdmin.getProxyAdmin(currentBridgeAddress)).to.be.equal(proxyAdmin.target);
    expect(await proxyAdmin.getProxyAdmin(currentGlobalExitRootAddress)).to.be.equal(proxyAdmin.target);
    expect(await proxyAdmin.getProxyAdmin(currentDataCommitteeAddress)).to.be.equal(proxyAdmin.target);
    expect(await proxyAdmin.owner()).to.be.equal(deployOutputParameters.timelockContractAddress);

    // deploy new verifier
    let verifierContract;
    if (realVerifier === true) {
        const VerifierRollup = await ethers.getContractFactory("FflonkVerifier", deployer);
        verifierContract = await VerifierRollup.deploy();
        await verifierContract.waitForDeployment();
    } else {
        const VerifierRollupHelperFactory = await ethers.getContractFactory("VerifierRollupHelperMock", deployer);
        verifierContract = await VerifierRollupHelperFactory.deploy();
        await verifierContract.waitForDeployment();
    }
    console.log("#######################\n");
    console.log("Verifier deployed to:", verifierContract.target);
    console.log(`npx hardhat verify ${verifierContract.target} --network ${process.env.HARDHAT_NETWORK}`);

    // load timelock
    const timelockContractFactory = await ethers.getContractFactory("PolygonZkEVMTimelock", deployer);

    // prapare upgrades

    // force import cdkValidium
    const OrigcdkValidiumFactory = await ethers.getContractFactory("CDKValidium", deployer);
    await upgrades.forceImport(currentPolygonZkEVMAddress, OrigcdkValidiumFactory, {
        kind: "transparent",
    });

    // Upgrade to rollup manager previous polygonZKEVM
    const PolygonRollupManagerFactory = await ethers.getContractFactory("CDKValidiumV2");

    let implRollupManager;

    for (let i = 0; i < attemptsDeployProxy; i++) {
        try {
            implRollupManager = await upgrades.prepareUpgrade(currentPolygonZkEVMAddress, PolygonRollupManagerFactory, {
                // constructorArgs: [currentGlobalExitRootAddress, polTokenAddress, currentBridgeAddress],
                constructorArgs: [verifierContract.target],
                unsafeAllow: ["constructor", "state-variable-immutable"],
            });
            break;
        } catch (error: any) {
            console.log(`attempt ${i}`);
            console.log("upgrades.deployProxy of PolygonRollupManager ", error.message);
        }

        // reach limits of attempts
        if (i + 1 === attemptsDeployProxy) {
            throw new Error("polygonZkEVMGlobalExitRoot contract has not been deployed");
        }
    }

    console.log("#######################\n");
    console.log(`Polygon rollup manager: ${implRollupManager}`);

    console.log("you can verify the new impl address with:");
    console.log(
        `npx hardhat verify --constructor-args upgrade/arguments.js ${implRollupManager} --network ${process.env.HARDHAT_NETWORK}\n`
    );
    console.log("Copy the following constructor arguments on: upgrade/arguments.js \n", [verifierContract.target]);

    const operationRollupManager = genOperation(
        proxyAdmin.target,
        0, // value
        proxyAdmin.interface.encodeFunctionData("upgrade", [currentPolygonZkEVMAddress, implRollupManager]),
        // proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
        //     currentPolygonZkEVMAddress,
        //     implRollupManager,
        //     PolygonRollupManagerFactory.interface.encodeFunctionData("initialize", [
        //         trustedAggregator,
        //         pendingStateTimeout,
        //         trustedAggregatorTimeout,
        //         admin,
        //         currentTimelockAddress,
        //         emergencyCouncilAddress,
        //         ethers.ZeroAddress, // unused parameter  // newPolygonZkEVMContract.target,
        //         ethers.ZeroAddress, // unused parameter // verifierContract.target,
        //         0, // unused parameter // newForkID,
        //         0, // unused parameter // chainID,
        //     ]),
        // ]),
        ethers.ZeroHash, // predecesoor
        salt // salt
    );

    let outputJson;

    {
        // Schedule operation
        const scheduleDataRollupManager = timelockContractFactory.interface.encodeFunctionData("scheduleBatch", [
            [operationRollupManager.target],
            [operationRollupManager.value],
            [operationRollupManager.data],
            ethers.ZeroHash, // predecesoor
            salt, // salt
            timelockDelay,
        ]);

        // Execute operation
        const executeDataRollupManager = timelockContractFactory.interface.encodeFunctionData("executeBatch", [
            [operationRollupManager.target],
            [operationRollupManager.value],
            [operationRollupManager.data],
            ethers.ZeroHash, // predecesoor
            salt, // salt
        ]);

        outputJson = {
            id: operationRollupManager.id,
            scheduleData: scheduleDataRollupManager,
            executeData: executeDataRollupManager,
            verifierAddress: verifierContract.target,
            newCDKValidium: implRollupManager,
            timelockContractAddress: currentTimelockAddress,
        };
        fs.writeFileSync(pathOutputJson, JSON.stringify(outputJson, null, 1));
    }

    console.log("done! check upgrade_output.json");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

// OZ test functions
function genOperation(target: any, value: any, data: any, predecessor: any, salt: any) {
    const id = keccak256(
        defaultAbiCoder.encode(
            ["address", "uint256", "bytes", "bytes32", "bytes32"],
            [target, value, data, predecessor, salt]
        )
    );
    return {
        id,
        target,
        value,
        data,
        predecessor,
        salt,
    };
}
