// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal subset of Flap's Portal interface needed to launch a TOKEN_TAXED_V3
/// token with native-dividend distribution enabled.
/// Full reference: https://docs.flap.sh/flap/developers
interface IFlapPortalLauncher {
    // Enum values per IPortalTypes (docs.flap.sh):
    // DexThreshType: 0=TWO_THIRDS 1=FOUR_FIFTHS 2=HALF ...
    // MigratorType:  0=V3_MIGRATOR 1=V2_MIGRATOR ... (tax tokens MUST use V2_MIGRATOR)
    // DEXId:         0=DEX0
    // V3LPFeeProfile:0=STANDARD
    // TokenVersion:  2=TOKEN_V2_PERMIT 6=TOKEN_TAXED_V3
    struct NewTokenV6Params {
        string name;
        string symbol;
        string meta;
        uint8 dexThresh;
        bytes32 salt;
        uint8 migratorType;
        address quoteToken;
        uint256 quoteAmt;
        address beneficiary;
        bytes permitData;
        bytes32 extensionID;
        bytes extensionData;
        uint8 dexId;
        uint8 lpFeeProfile;
        uint16 buyTaxRate;
        uint16 sellTaxRate;
        uint64 taxDuration;
        uint64 antiFarmerDuration;
        uint16 mktBps;
        uint16 deflationBps;
        uint16 dividendBps;
        uint16 lpBps;
        uint256 minimumShareBalance;
        address dividendToken;
        address commissionReceiver;
        uint8 tokenVersion;
    }

    function newTokenV6(NewTokenV6Params calldata params) external payable returns (address token);
}
