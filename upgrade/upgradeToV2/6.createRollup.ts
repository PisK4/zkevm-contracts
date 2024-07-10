/* eslint-disable no-await-in-loop, no-use-before-define, no-lonely-if */
/* eslint-disable no-console, no-inner-declarations, no-undef, import/no-unresolved */
import {expect} from "chai";
import path = require("path");
import fs = require("fs");

import * as dotenv from "dotenv";
dotenv.config({path: path.resolve(__dirname, "../../.env")});
import {ethers, upgrades} from "hardhat";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
// const {create2Deployment} = require("../helpers/deployment-helpers");
// const pathGenesis = path.join(__dirname, "./genesis.json");
const createRollupParameters = require("./create_rollup_parameters.json");
const genesis = require("./genesis.json");
const deployOutput = require("./deploy_output.json");

const upgradeOutoutPath = path.join(__dirname, "./upgrade_output.json");
const upgradeOutput = require(upgradeOutoutPath);

// import "../helpers/utils";

const pathOutputJson = path.join(__dirname, "./create_rollup_output.json");

import {
    PolygonRollupManager,
    // PolygonZkEVMV2,
    PolygonZkEVMBridgeV2,
    // PolygonValidium,
    PolygonValidiumEtrog,
} from "../../typechain-types";

async function main() {
    const attemptsDeployProxy = 20;

    const outputJson = {} as any;

    /*
     * Check deploy parameters
     * Check that every necessary parameter is fullfilled
     */
    const mandatoryDeploymentParameters = [
        "realVerifier",
        "trustedSequencerURL",
        "networkName",
        "description",
        "trustedSequencer",
        "chainID",
        "adminZkEVM",
        "forkID",
        "consensusContract",
    ];

    for (const parameterName of mandatoryDeploymentParameters) {
        if (createRollupParameters[parameterName] === undefined || createRollupParameters[parameterName] === "") {
            throw new Error(`Missing parameter: ${parameterName}`);
        }
    }

    const {
        realVerifier,
        trustedSequencerURL,
        networkName,
        description,
        trustedSequencer,
        chainID,
        adminZkEVM,
        forkID,
        consensusContract,
    } = createRollupParameters;

    const supportedConensus = ["PolygonZkEVMEtrog", "PolygonValidiumEtrog"];

    if (!supportedConensus.includes(consensusContract)) {
        throw new Error(`Consensus contract not supported, supported contracts are: ${supportedConensus}`);
    }

    const dataAvailabilityProtocol = createRollupParameters.dataAvailabilityProtocol || "PolygonDataCommittee";

    const supporteDataAvailabilityProtocols = ["PolygonDataCommittee"];

    if (
        consensusContract.includes("PolygonValidium") &&
        !supporteDataAvailabilityProtocols.includes(dataAvailabilityProtocol)
    ) {
        throw new Error(
            `Data availability protocol not supported, supported data availability protocols are: ${supporteDataAvailabilityProtocols}`
        );
    }

    // Load provider
    let currentProvider = ethers.provider;

    let deployer;
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
    console.log("create rollup start");
    console.log("deploying with: ", deployer.address);

    // Load Rollup manager
    const PolgonRollupManagerFactory = await ethers.getContractFactory("PolygonRollupManager", deployer);
    const rollupManagerContract = PolgonRollupManagerFactory.attach(
        deployOutput.cdkValidiumAddress
    ) as PolygonRollupManager;

    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
    // if ((await rollupManagerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)) == false) {
    //     throw new Error(
    //         `Deployer does not have admin role. Use the test flag on deploy_parameters if this is a test deployment`
    //     );
    // }

    // let verifierContract;
    // if (realVerifier === true) {
    //     const VerifierRollup = await ethers.getContractFactory("FflonkVerifier", deployer);
    //     verifierContract = await VerifierRollup.deploy();
    //     await verifierContract.waitForDeployment();
    // } else {
    //     const VerifierRollupHelperFactory = await ethers.getContractFactory("VerifierRollupHelperMock", deployer);
    //     verifierContract = await VerifierRollupHelperFactory.deploy();
    //     await verifierContract.waitForDeployment();
    // }

    const verifierContract = (await ethers.getContractFactory("FflonkVerifier", deployer)).attach(
        upgradeOutput.verifierAddress
    );

    // // Since it's a mock deployment deployer has all the rights
    // const ADD_ROLLUP_TYPE_ROLE = ethers.id("ADD_ROLLUP_TYPE_ROLE");
    // const CREATE_ROLLUP_ROLE = ethers.id("CREATE_ROLLUP_ROLE");

    // // Check role:

    // if ((await rollupManagerContract.hasRole(ADD_ROLLUP_TYPE_ROLE, deployer.address)) == false)
    //     await rollupManagerContract.grantRole(ADD_ROLLUP_TYPE_ROLE, deployer.address);

    // if ((await rollupManagerContract.hasRole(CREATE_ROLLUP_ROLE, deployer.address)) == false)
    //     await rollupManagerContract.grantRole(CREATE_ROLLUP_ROLE, deployer.address);

    // // Create consensus implementation
    // const PolygonconsensusFactory = (await ethers.getContractFactory(consensusContract, deployer)) as any;
    // let PolygonconsensusContract;

    // PolygonconsensusContract = await PolygonconsensusFactory.deploy(
    //     deployOutput.polygonZkEVMGlobalExitRootAddress,
    //     deployOutput.polTokenAddress,
    //     deployOutput.polygonZkEVMBridgeAddress,
    //     deployOutput.polygonRollupManagerAddress
    // );
    // await PolygonconsensusContract.waitForDeployment();

    // // Add a new rollup type with timelock
    // const rollupCompatibilityID = 0;
    // await (
    //     await rollupManagerContract.addNewRollupType(
    //         PolygonconsensusContract.target,
    //         verifierContract.target,
    //         forkID,
    //         rollupCompatibilityID,
    //         genesis.root,
    //         description
    //     )
    // ).wait();
    const PolygonconsensusFactory = (await ethers.getContractFactory("PolygonValidiumEtrog", deployer)) as any;
    // const PolygonconsensusContract = PolygonconsensusFactory.attach(upgradeOutput.newPolygonZKEVMImpl);

    // console.log("#######################\n");
    // console.log("Added new Rollup Type deployed");
    const newRollupTypeID = await rollupManagerContract.rollupTypeCount();

    let gasTokenAddress, gasTokenNetwork, gasTokenMetadata;

    if (
        createRollupParameters.gasTokenAddress &&
        createRollupParameters.gasTokenAddress != "" &&
        createRollupParameters.gasTokenAddress != ethers.ZeroAddress
    ) {
        // Get bridge instance
        const bridgeFactory = await ethers.getContractFactory("PolygonZkEVMBridgeV2", deployer);
        const polygonZkEVMBridgeContract = bridgeFactory.attach(
            deployOutput.polygonZkEVMBridgeAddress
        ) as PolygonZkEVMBridgeV2;

        // Get token metadata
        gasTokenMetadata = await polygonZkEVMBridgeContract.getTokenMetadata(createRollupParameters.gasTokenAddress);

        const wrappedData = await polygonZkEVMBridgeContract.wrappedTokenToTokenInfo(
            createRollupParameters.gasTokenAddress
        );
        if (wrappedData.originNetwork != 0n) {
            // Wrapped token
            gasTokenAddress = wrappedData.originTokenAddress;
            gasTokenNetwork = wrappedData.originNetwork;
        } else {
            // Mainnet token
            gasTokenAddress = createRollupParameters.gasTokenAddress;
            gasTokenNetwork = 0n;
        }
    } else {
        gasTokenAddress = ethers.ZeroAddress;
        gasTokenNetwork = 0;
        gasTokenMetadata = "0x";
    }

    // const newZKEVMAddress = ethers.getCreateAddress({
    //     from: rollupManagerContract.target as string,
    //     nonce: await currentProvider.getTransactionCount(rollupManagerContract.target),
    // });
    let receipt;
    let blockDeploymentRollup;
    let timestampReceipt;
    // try {
    const txDeployRollup = await rollupManagerContract.createNewRollup(
        newRollupTypeID,
        chainID,
        adminZkEVM,
        trustedSequencer,
        gasTokenAddress,
        trustedSequencerURL,
        networkName
    );
    receipt = (await txDeployRollup.wait()) as any;
    blockDeploymentRollup = await receipt?.getBlock();
    timestampReceipt = blockDeploymentRollup.timestamp;
    // } catch (error) {}
    // Create new rollup

    const rollupID = await rollupManagerContract.chainIDToRollupID(chainID);

    console.log("#######################\n");

    const newZKEVMAddress = ethers.getCreateAddress({
        from: deployOutput.cdkValidiumAddress as string,
        nonce: (await currentProvider.getTransactionCount(deployOutput.cdkValidiumAddress)) - 1,
    });

    // const newZKEVMAddress = upgradeOutput.newPolygonZKEVM;
    expect(ethers.provider.getCode(newZKEVMAddress)).to.not.eq("0x");

    console.log("Created new Rollup:", newZKEVMAddress);

    // deploy data commitee
    // const PolygonDataCommitteeContract = (await ethers.getContractFactory("PolygonDataCommittee", deployer)) as any;
    // let polygonDataCommittee;

    // for (let i = 0; i < attemptsDeployProxy; i++) {
    //     try {
    //         polygonDataCommittee = await upgrades.deployProxy(PolygonDataCommitteeContract, [], {
    //             unsafeAllow: ["constructor"],
    //         });
    //         break;
    //     } catch (error: any) {
    //         console.log(`attempt ${i}`);
    //         console.log("upgrades.deployProxy of polygonDataCommittee ", error.message);
    //     }
    //     // reach limits of attempts
    //     if (i + 1 === attemptsDeployProxy) {
    //         throw new Error("polygonDataCommittee contract has not been deployed");
    //     }
    // }
    // await polygonDataCommittee?.waitForDeployment();

    const polygonDataCommittee = (await ethers.getContractFactory("PolygonDataCommittee", deployer)).attach(
        deployOutput.cdkDataCommitteeContract
    ) as any;

    // Load data commitee
    const PolygonValidiumContract = await PolygonconsensusFactory.attach(newZKEVMAddress);
    // const PolygonValidiumContract = await PolygonconsensusFactory.attach(upgradeOutput.newPolygonZKEVM);
    // add data commitee to the consensus contract
    // if ((await PolygonValidiumContract.admin()) == deployer.address) {
    const admin = await PolygonValidiumContract.admin();
    console.log("consensus Validium admin:", admin);
    await (await PolygonValidiumContract.setDataAvailabilityProtocol(polygonDataCommittee?.target as any)).wait();
    console.log(`add data commitee to the consensus contract: ${polygonDataCommittee?.target}`);

    const commiteeOwner = await polygonDataCommittee?.owner();
    if (commiteeOwner == deployer.address) {
        console.log("Setup data commitee to 0");
        await (await polygonDataCommittee?.setupCommittee(0, [], "0x")).wait();
    } else {
        console.log(`please use ${commiteeOwner} to setup data commitee`);
    }
    //     console.log("Setup data commitee to 0");
    // } else {
    //     await (await polygonDataCommittee?.transferOwnership(adminZkEVM)).wait();
    // }

    outputJson.polygonDataCommitteeAddress = polygonDataCommittee?.target;

    // Assert admin address
    // expect(await upgrades.erc1967.getAdminAddress(newZKEVMAddress)).to.be.equal(rollupManagerContract.target);
    // expect(await upgrades.erc1967.getImplementationAddress(newZKEVMAddress)).to.be.equal(
    //     PolygonconsensusContract.target
    // );

    // Search added global exit root on the logs
    let globalExitRoot;
    try {
        for (const log of receipt?.logs) {
            if (log.address == newZKEVMAddress) {
                const parsedLog = PolygonconsensusFactory.interface.parseLog(log);
                if (parsedLog != null && parsedLog.name == "InitialSequenceBatches") {
                    globalExitRoot = parsedLog.args.lastGlobalExitRoot;
                }
            }
        }

        // Add the first batch of the created rollup
        const newZKEVMContract = await PolygonconsensusFactory.attach(newZKEVMAddress);
        const batchData = {
            transactions: await newZKEVMContract.generateInitializeTransaction(
                rollupID,
                gasTokenAddress,
                gasTokenNetwork,
                gasTokenMetadata as any
            ),
            globalExitRoot: globalExitRoot,
            timestamp: timestampReceipt,
            sequencer: trustedSequencer,
        };

        outputJson.firstBatchData = batchData;
        outputJson.genesis = genesis.root;
        outputJson.createRollupBlockNumber = blockDeploymentRollup.number;
        outputJson.rollupAddress = newZKEVMAddress;
        outputJson.verifierAddress = verifierContract.target;
        outputJson.consensusContract = consensusContract;

        fs.writeFileSync(pathOutputJson, JSON.stringify(outputJson, null, 1));
    } catch (error) {}
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
