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

const deployParameters = require("./deploy_parameters.json");
const deployOutputParameters = require("./deploy_output.json");
const upgradeParameters = require("./upgrade_parameters.json");

const resetFork = async (block: number = parseInt(process.env.HARDHAT_FORK_NUMBER!)) => {
    await hre.network.provider.request({
        method: "hardhat_reset",
        params: [
            {
                forking: {
                    jsonRpcUrl: process.env.HARDHAT_FORK_URL || "",
                    blockNumber: block,
                },
            },
        ],
    });
};

async function main() {
    upgrades.silenceWarnings();

    if (hre.network.name !== "hardhat") {
        console.log(`reset hardhat network`);
        await resetFork();
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
    const currentGlobalExitRootAddress = deployOutputParameters.polygonZkEVMGlobalExitRootAddress;
    const currentPolygonZkEVMAddress = deployOutputParameters.cdkValidiumAddress;
    const currentTimelockAddress = deployOutputParameters.timelockContractAddress;

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
    if (deployParameters.deployerPvtKey) {
        deployer = new ethers.Wallet(deployParameters.deployerPvtKey, currentProvider);
    } else if (process.env.DEPLOYER_PRIVATE_KEY) {
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

    // Assert correct admin
    // expect(await upgrades.erc1967.getAdminAddress(currentPolygonZkEVMAddress as string)).to.be.equal(proxyAdmin.target);

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

    // force import bridge
    const OrigBridgeFactory = await ethers.getContractFactory("PolygonZkEVMBridge", deployer);
    await upgrades.forceImport(currentBridgeAddress, OrigBridgeFactory, {
        kind: "transparent",
    });

    // Prepare Upgrade PolygonZkEVMBridge
    const polygonZkEVMBridgeFactory = await ethers.getContractFactory("PolygonZkEVMBridgeV2", deployer);

    const newBridgeImpl = await upgrades.prepareUpgrade(currentBridgeAddress, polygonZkEVMBridgeFactory, {
        unsafeAllow: ["constructor"],
    });

    console.log("#######################\n");
    console.log(`PolygonZkEVMBridge impl: ${newBridgeImpl}`);

    console.log("you can verify the new impl address with:");
    console.log(`npx hardhat verify ${newBridgeImpl} --network ${process.env.HARDHAT_NETWORK}`);

    const operationBridge = genOperation(
        proxyAdmin.target,
        0, // value
        proxyAdmin.interface.encodeFunctionData("upgrade", [currentBridgeAddress, newBridgeImpl]),
        ethers.ZeroHash, // predecesoor
        salt // salt
    );

    // prepare upgrade global exit root
    // Prepare Upgrade  PolygonZkEVMGlobalExitRootV2
    const polygonGlobalExitRootV2 = await ethers.getContractFactory("PolygonZkEVMGlobalExitRootV2", deployer);
    // force import GlobalExitRoot
    const OrigGlobalExitRootFactory = await ethers.getContractFactory("PolygonZkEVMGlobalExitRoot", deployer);
    await upgrades.forceImport(currentGlobalExitRootAddress, OrigGlobalExitRootFactory, {
        kind: "transparent",
    });

    const newGlobalExitRoortImpl = await upgrades.prepareUpgrade(
        currentGlobalExitRootAddress,
        polygonGlobalExitRootV2,
        {
            constructorArgs: [currentPolygonZkEVMAddress, currentBridgeAddress],
            unsafeAllow: ["constructor", "state-variable-immutable"],
        }
    );

    console.log("#######################\n");
    console.log(`polygonGlobalExitRootV2 impl: ${newGlobalExitRoortImpl}`);

    console.log("you can verify the new impl address with:");
    console.log(
        `npx hardhat verify --constructor-args upgrade/arguments.js ${newGlobalExitRoortImpl} --network ${process.env.HARDHAT_NETWORK}\n`
    );
    console.log("Copy the following constructor arguments on: upgrade/arguments.js \n", [
        currentPolygonZkEVMAddress,
        currentBridgeAddress,
    ]);

    const operationGlobalExitRoot = genOperation(
        proxyAdmin.target,
        0, // value
        proxyAdmin.interface.encodeFunctionData("upgrade", [currentGlobalExitRootAddress, newGlobalExitRoortImpl]),
        ethers.ZeroHash, // predecesoor
        salt // salt
    );

    // Update current system to rollup manager

    // deploy polygon zkEVM impl
    const PolygonZkEVMV2ExistentFactory = await ethers.getContractFactory("PolygonZkEVMExistentEtrog");
    const polygonZkEVMEtrogImpl = await PolygonZkEVMV2ExistentFactory.deploy(
        currentGlobalExitRootAddress,
        polTokenAddress,
        currentBridgeAddress,
        currentPolygonZkEVMAddress
    );
    await polygonZkEVMEtrogImpl.waitForDeployment();

    console.log("#######################\n");
    console.log(`new PolygonZkEVM impl: ${polygonZkEVMEtrogImpl.target}`);

    console.log("you can verify the new impl address with:");
    console.log(
        `npx hardhat verify --constructor-args upgrade/arguments.js ${polygonZkEVMEtrogImpl.target} --network ${process.env.HARDHAT_NETWORK}\n`
    );
    console.log("Copy the following constructor arguments on: upgrade/arguments.js \n", [
        currentGlobalExitRootAddress,
        polTokenAddress,
        currentBridgeAddress,
        currentPolygonZkEVMAddress,
    ]);

    // deploy polygon zkEVM proxy
    const PolygonTransparentProxy = await ethers.getContractFactory("PolygonTransparentProxy");
    const newPolygonZkEVMContract = await PolygonTransparentProxy.deploy(
        polygonZkEVMEtrogImpl.target,
        currentPolygonZkEVMAddress,
        "0x"
    );
    await newPolygonZkEVMContract.waitForDeployment();
    console.log("#######################\n");
    console.log(`new PolygonZkEVM Proxy: ${newPolygonZkEVMContract.target}`);

    console.log("you can verify the new impl address with:");
    console.log(
        `npx hardhat verify --constructor-args upgrade/arguments.js ${newPolygonZkEVMContract.target} --network ${process.env.HARDHAT_NETWORK}\n`
    );
    console.log("Copy the following constructor arguments on: upgrade/arguments.js \n", [
        polygonZkEVMEtrogImpl.target,
        currentPolygonZkEVMAddress,
        "0x",
    ]);

    // force import cdkValidium
    const OrigcdkValidiumFactory = await ethers.getContractFactory("CDKValidium", deployer);
    await upgrades.forceImport(currentPolygonZkEVMAddress, OrigcdkValidiumFactory, {
        kind: "transparent",
    });

    // Upgrade to rollup manager previous polygonZKEVM
    const PolygonRollupManagerFactory = await ethers.getContractFactory("PolygonRollupManager");
    const implRollupManager = await upgrades.prepareUpgrade(currentPolygonZkEVMAddress, PolygonRollupManagerFactory, {
        constructorArgs: [currentGlobalExitRootAddress, polTokenAddress, currentBridgeAddress],
        unsafeAllow: ["constructor", "state-variable-immutable"],
    });

    console.log("#######################\n");
    console.log(`Polygon rollup manager: ${implRollupManager}`);

    console.log("you can verify the new impl address with:");
    console.log(
        `npx hardhat verify --constructor-args upgrade/arguments.js ${implRollupManager} --network ${process.env.HARDHAT_NETWORK}\n`
    );
    console.log("Copy the following constructor arguments on: upgrade/arguments.js \n", [
        currentGlobalExitRootAddress,
        polTokenAddress,
        currentBridgeAddress,
    ]);

    const operationRollupManager = genOperation(
        proxyAdmin.target,
        0, // value
        proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
            currentPolygonZkEVMAddress,
            implRollupManager,
            PolygonRollupManagerFactory.interface.encodeFunctionData("initialize", [
                trustedAggregator,
                pendingStateTimeout,
                trustedAggregatorTimeout,
                admin,
                currentTimelockAddress,
                emergencyCouncilAddress,
                newPolygonZkEVMContract.target,
                verifierContract.target,
                newForkID,
                chainID,
            ]),
        ]),
        ethers.ZeroHash, // predecesoor
        salt // salt
    );

    // Schedule operation
    const scheduleData = timelockContractFactory.interface.encodeFunctionData("scheduleBatch", [
        [operationGlobalExitRoot.target, operationBridge.target, operationRollupManager.target],
        [operationGlobalExitRoot.value, operationBridge.value, operationRollupManager.value],
        [operationGlobalExitRoot.data, operationBridge.data, operationRollupManager.data],
        ethers.ZeroHash, // predecesoor
        salt, // salt
        timelockDelay,
    ]);

    // Execute operation
    const executeData = timelockContractFactory.interface.encodeFunctionData("executeBatch", [
        [operationGlobalExitRoot.target, operationBridge.target, operationRollupManager.target],
        [operationGlobalExitRoot.value, operationBridge.value, operationRollupManager.value],
        [operationGlobalExitRoot.data, operationBridge.data, operationRollupManager.data],
        ethers.ZeroHash, // predecesoor
        salt, // salt
    ]);

    // console.log({scheduleData});
    // console.log({executeData});

    const outputJson = {
        scheduleData,
        executeData,
        verifierAddress: verifierContract.target,
        newPolygonZKEVM: newPolygonZkEVMContract.target,
        timelockContractAddress: currentTimelockAddress,
    };
    fs.writeFileSync(pathOutputJson, JSON.stringify(outputJson, null, 1));
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
