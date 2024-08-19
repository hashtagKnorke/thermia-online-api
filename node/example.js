const readline = require('readline');
const  Thermia  = require('./Thermia');
const { USERNAME, PASSWORD, API_TYPE } = require('./credential');
const {
    THERMIA_API_TYPE_CLASSIC,
    THERMIA_API_TYPE_GENESIS,
} = require('./ThermiaOnlineAPIConst');

const CHANGE_HEAT_PUMP_DATA_DURING_TEST = false; // Set to true if you want to change heat pump data during test

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function getInput(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer);
        });
    });
}

async function main() {
    let username = USERNAME;
    let password = PASSWORD;
    let apiType = API_TYPE;

    if (!username || !password) {
        username = await getInput("Enter username: ");
        password = await getInput("Enter password: ");
    }

    if (!apiType) {
        const apiTypeNumber = await getInput("Enter api type (1 = classic, 2 = genesis): ");
        if (apiTypeNumber === "1") {
            apiType = THERMIA_API_TYPE_CLASSIC;
        } else if (apiTypeNumber === "2") {
            apiType = THERMIA_API_TYPE_GENESIS;
        } else {
            console.log("Invalid api type");
            process.exit(1);
        }
    }

    const thermia = new Thermia(username, password, apiType );

    console.log("Connected: " + thermia.connected);

    const heatPump = thermia.fetchHeatPumps()[0];

    heatPump.debug();

    console.log("\n");

    console.log("All available register groups: " + heatPump.getAllAvailableRegisterGroups());

    console.log("Available registers for 'REG_GROUP_HEATING_CURVE' group: " + heatPump.getAvailableRegistersForGroup("REG_GROUP_HEATING_CURVE"));

    console.log("\n");

    console.log("Other temperatures");
    console.log("Supply Line Temperature: " + heatPump.supplyLineTemperature);
    console.log("Desired Supply Line Temperature: " + heatPump.desiredSupplyLineTemperature);
    console.log("Return Line Temperature: " + heatPump.returnLineTemperature);
    console.log("Brine Out Temperature: " + heatPump.brineOutTemperature);
    console.log("Pool Temperature: " + heatPump.poolTemperature);
    console.log("Brine In Temperature: " + heatPump.brineInTemperature);
    console.log("Cooling Tank Temperature: " + heatPump.coolingTankTemperature);
    console.log("Cooling Supply Line Temperature: " + heatPump.coolingSupplyLineTemperature);

    console.log("\n");

    console.log("Operational status");
    console.log("Running operational statuses: " + heatPump.runningOperationalStatuses);
    console.log("Available operational statuses: " + heatPump.availableOperationalStatuses);
    console.log("Available operational statuses map: " + heatPump.availableOperationalStatusesMap);
    console.log("Auxiliary heater 3KW: " + heatPump.operationalStatusAuxiliaryHeater3kw);
    console.log("Auxiliary heater 6KW: " + heatPump.operationalStatusAuxiliaryHeater6kw);
    console.log("Auxiliary heater 9KW: " + heatPump.operationalStatusAuxiliaryHeater9kw);
    console.log("Auxiliary heater 12KW: " + heatPump.operationalStatusAuxiliaryHeater12kw);
    console.log("Auxiliary heater 15KW: " + heatPump.operationalStatusAuxiliaryHeater15kw);

    console.log("Compressor status: " + heatPump.operationalStatusCompressorStatus);
    console.log("Brine pump status: " + heatPump.operationalStatusBrinePumpStatus);
    console.log("Radiator pump status: " + heatPump.operationalStatusRadiatorPumpStatus);
    console.log("Cooling status: " + heatPump.operationalStatusCoolingStatus);
    console.log("Hot water status: " + heatPump.operationalStatusHotWaterStatus);
    console.log("Heating status: " + heatPump.operationalStatusHeatingStatus);
    console.log("Integral: " + heatPump.operationalStatusIntegral);
    console.log("Pid: " + heatPump.operationalStatusPid);

    console.log("\n");

    console.log("Operational Times");
    console.log("Compressor Operational Time: " + heatPump.compressorOperationalTime);
    console.log("Hot Water Operational Time: " + heatPump.hotWaterOperationalTime);
    console.log("Auxiliary Heater 1 Operational Time: " + heatPump.auxiliaryHeater1OperationalTime);
    console.log("Auxiliary Heater 2 Operational Time: " + heatPump.auxiliaryHeater2OperationalTime);
    console.log("Auxiliary Heater 3 Operational Time: " + heatPump.auxiliaryHeater3OperationalTime);

    console.log("\n");

    console.log("Alarms data");
    console.log("Active Alarm Count: " + heatPump.activeAlarmCount);
    if (heatPump.activeAlarmCount > 0) {
        console.log("Active Alarms: " + heatPump.activeAlarms);
    }

    console.log("\n");

    console.log("Operation Mode data");
    console.log("Operation Mode: " + heatPump.operationMode);
    console.log("Available Operation Modes: " + heatPump.availableOperationModes);
    console.log("Available Operation Modes Map: " + heatPump.availableOperationModeMap);
    console.log("Is Operation Mode Read Only: " + heatPump.isOperationModeReadOnly);

    console.log("\n");

    console.log("Hot Water data");
    console.log("Hot Water Switch State: " + heatPump.hotWaterSwitchState);
    console.log("Hot Water Boost Switch State: " + heatPump.hotWaterBoostSwitchState);

    console.log("\n");

    console.log("Available historical data registers: " + heatPump.historicalDataRegisters);
    console.log("Historical data for outdoor temperature during past 24h: " + heatPump.getHistoricalDataForRegister(
        "REG_OPER_DATA_OUTDOOR_TEMP_MA_SA",
        new Date(Date.now() - 24 * 60 * 60 * 1000),
        new Date()
    ));

    console.log("\n");

    console.log("Heating Curve Register Data: " + heatPump.getRegisterDataByRegisterGroupAndName(
        "REG_GROUP_HEATING_CURVE", "REG_HEATING_HEAT_CURVE"
    ));

    console.log("\n");

    thermia.updateData();

    if (CHANGE_HEAT_PUMP_DATA_DURING_TEST) {
        heatPump.setTemperature(19);

        heatPump.setRegisterDataByRegisterGroupAndName(
            "REG_GROUP_HEATING_CURVE", "REG_HEATING_HEAT_CURVE", 30
        );

        heatPump.setOperationMode("COMPRESSOR");

        if (heatPump.hotWaterSwitchState) {
            heatPump.setHotWaterSwitchState(1);
        }

        if (heatPump.hotWaterBoostSwitchState) {
            heatPump.setHotWaterBoostSwitchState(1);
        }
    }

    console.log("Heat Temperature: " + heatPump.heatTemperature);
    console.log("Operation Mode: " + heatPump.operationMode);
    console.log("Available Operation Modes: " + heatPump.availableOperationModes);

    console.log("Hot Water Switch State: " + heatPump.hotWaterSwitchState);
    console.log("Hot Water Boost Switch State: " + heatPump.hotWaterBoostSwitchState);

    rl.close();
}

main();