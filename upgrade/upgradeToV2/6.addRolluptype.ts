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
const pathGenesis = path.join(__dirname, "./genesis.json");
const genesis = require("./genesis.json");
const createRollupParameters = require("./create_rollup_parameters.json");
const upgradeOutoutPath = path.join(__dirname, "./upgrade_output.json");
const upgradeOutput = require(upgradeOutoutPath);

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
    // // check if current network is localhost
    // if (hre.network.name === "localhost") {
    //     console.log(`reset hardhat network: ${hre.network.name}`);
    //     await resetFork();
    // }

    const attemptsDeployProxy = 20;
    const {trustedSequencerURL, networkName, description, trustedSequencer, adminZkEVM, forkID, consensusContract} =
        createRollupParameters;

    upgrades.silenceWarnings();

    console.log(`current block: ${await ethers.provider.getBlockNumber()}`);

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

    const timelockContractFactory = await ethers.getContractFactory("PolygonZkEVMTimelock", deployer);
    const PolygonRollupManagerFactory = await ethers.getContractFactory("PolygonRollupManager", deployer);
    const polygonZkEVMEtrogImpl = await upgrades.erc1967.getImplementationAddress(upgradeOutput.newPolygonZKEVM);

    const rollupCompatibilityID = 0;
    const operation_AddNewRollupType = genOperation(
        currentPolygonZkEVMAddress,
        0, // value
        PolygonRollupManagerFactory.interface.encodeFunctionData("addNewRollupType", [
            polygonZkEVMEtrogImpl,
            upgradeOutput.verifierAddress,
            forkID,
            rollupCompatibilityID,
            genesis.root,
            description,
        ]),
        ethers.ZeroHash, // predecesoor
        salt // salt
    );

    let outputJson;

    {
        // Schedule operation
        const scheduleData = timelockContractFactory.interface.encodeFunctionData("scheduleBatch", [
            [operation_AddNewRollupType.target],
            [operation_AddNewRollupType.value],
            [operation_AddNewRollupType.data],
            ethers.ZeroHash, // predecesoor
            salt, // salt
            timelockDelay,
        ]);

        // Execute operation
        const executeData = timelockContractFactory.interface.encodeFunctionData("executeBatch", [
            [operation_AddNewRollupType.target],
            [operation_AddNewRollupType.value],
            [operation_AddNewRollupType.data],
            ethers.ZeroHash, // predecesoor
            salt, // salt
        ]);

        // console.log({scheduleData});
        // console.log({executeData});

        outputJson = {
            scheduleData,
            executeData,
            verifierAddress: upgradeOutput.verifierAddress,
            newPolygonZKEVM: upgradeOutput.newPolygonZKEVM,
            // polygonDataCommittee: PolygonDataCommitteeContract.target,
            timelockContractAddress: currentTimelockAddress,
        };
    }

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
