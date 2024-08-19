const fs = require('fs');
const { ChainMap } = require('collections');
const { format: formatDateTime, parse: parseDateTime } = require('date-fns');
const { axios } = require( 'axios');
    const { winston} = require( 'winston');
        const { getDictValueOrNone, getDictValueOrDefault, prettyPrintExcept }  = require('./utils/utils');
        const {
  REG_BRINE_IN,
  REG_BRINE_OUT,
  REG_ACTUAL_POOL_TEMP,
  REG_COOL_SENSOR_SUPPLY,
  REG_COOL_SENSOR_TANK,
  REG_DESIRED_SUPPLY_LINE,
  REG_DESIRED_SUPPLY_LINE_TEMP,
  REG_DESIRED_SYS_SUPPLY_LINE_TEMP,
  REG_INTEGRAL_LSD,
  REG_OPERATIONAL_STATUS_PRIO1,
  REG_OPERATIONAL_STATUS_PRIORITY_BITMASK,
  REG_OPER_DATA_RETURN,
  REG_OPER_DATA_SUPPLY_MA_SA,
  REG_OPER_TIME_COMPRESSOR,
  REG_OPER_TIME_HOT_WATER,
  REG_OPER_TIME_IMM1,
  REG_OPER_TIME_IMM2,
  REG_OPER_TIME_IMM3,
  REG_PID,
  REG_RETURN_LINE,
  COMP_STATUS,
  COMP_STATUS_ITEC,
  REG_SUPPLY_LINE,
  DATETIME_FORMAT,
  REG_OPER_DATA_BUFFER_TANK,
} = require('./ThermiaOnlineAPIConst');

const DEFAULT_REGISTER_INDEXES = {
  temperature: null,
  operation_mode: null,
  hot_water_switch: null,
  hot_water_boost_switch: null,
};

class ThermiaHeatPump {
  constructor(deviceData, apiInterface) {
    this._deviceId = String(deviceData.id);
    this._apiInterface = apiInterface;

    this._logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple(),
        }),
      ],
    });

    this._info = null;
    this._status = null;
    this._deviceData = null;

    this._deviceConfig = {
      operational_status_register: null,
      operational_status_valueNamePrefix: null,
      operational_status_minRegisterValue: null,
    };

    this._groupTemperatures = null;
    this._groupOperationalStatus = null;
    this._groupOperationalTime = null;
    this._groupOperationalOperation = null;
    this._groupHotWater = {
      hot_water_switch: null,
      hot_water_boost_switch: null,
    };

    this._alarms = null;
    this._historicalDataRegistersMap = null;

    this._registerIndexes = DEFAULT_REGISTER_INDEXES;

    this._operationalStatuses = null;
    this._allOperationalStatusesMap = null;
    this._visibleOperationalStatusesMap = null;
    this._runningOperationalStatuses = null;

    this.updateData();
  }

  async updateData() {
    this._info = await this._apiInterface.getDeviceInfo(this._deviceId);
    this._status = await this._apiInterface.getDeviceStatus(this._deviceId);
    this._deviceData = await this._apiInterface.getDeviceById(this._deviceId);

    this._registerIndexes.temperature = getDictValueOrDefault(
      this._status,
      'heatingEffectRegisters',
      [null, null]
    )[1];

    this._groupTemperatures = await this._apiInterface.getGroupTemperatures(this._deviceId);
    this._groupOperationalStatus = await this._apiInterface.getGroupOperationalStatus(this._deviceId);
    this._groupOperationalTime = await this._apiInterface.getGroupOperationalTime(this._deviceId);
    this._groupOperationalOperation = await this._apiInterface.getGroupOperationalOperation(this);
    this._groupHotWater = await this._apiInterface.getGroupHotWater(this);

    this._alarms = await this._apiInterface.getAllAlarms(this._deviceId);

    this._operationalStatuses = this._getOperationalStatusesFromOperationalStatus();
    this._allOperationalStatusesMap = this._getAllOperationalStatusesFromOperationalStatus();
    this._visibleOperationalStatusesMap = this._getAllVisibleOperationalStatusesFromOperationalStatus();
    this._runningOperationalStatuses = this._getRunningOperationalStatuses();
  }

  getRegisterIndexes() {
    return this._registerIndexes;
  }

  setRegisterIndexOperationMode(registerIndex) {
    this._registerIndexes.operation_mode = registerIndex;
  }

  setRegisterIndexHotWaterSwitch(registerIndex) {
    this._registerIndexes.hot_water_switch = registerIndex;
  }

  setRegisterIndexHotWaterBoostSwitch(registerIndex) {
    this._registerIndexes.hot_water_boost_switch = registerIndex;
  }

  async setTemperature(temperature) {
    if (!this._status) {
      this._logger.error('Status not available, cannot set temperature');
      return;
    }

    this._logger.info(`Setting temperature to ${temperature}`);

    this._status.heatingEffect = temperature;
    await this._apiInterface.setTemperature(this, temperature);
    await this.updateData();
  }

  async setOperationMode(mode) {
    this._logger.info(`Setting operation mode to ${mode}`);

    if (this._groupOperationalOperation) {
      this._groupOperationalOperation.current = mode;
    }
    await this._apiInterface.setOperationMode(this, mode);
    await this.updateData();
  }

  async setHotWaterSwitchState(state) {
    this._logger.info(`Setting hot water switch to ${state}`);

    if (this._groupHotWater.hot_water_switch === null) {
      this._logger.error('Hot water switch not available');
      return;
    }

    this._groupHotWater.hot_water_switch = state;
    await this._apiInterface.setHotWaterSwitchState(this, state);
    await this.updateData();
  }

  async setHotWaterBoostSwitchState(state) {
    this._logger.info(`Setting hot water boost switch to ${state}`);

    if (this._groupHotWater.hot_water_boost_switch === null) {
      this._logger.error('Hot water boost switch not available');
      return;
    }

    this._groupHotWater.hot_water_boost_switch = state;
    await this._apiInterface.setHotWaterBoostSwitchState(this, state);
    await this.updateData();
  }

  async getAllAvailableRegisterGroups() {
    const installationProfileId = getDictValueOrNone(this._info, 'installationProfileId');

    if (!installationProfileId) {
      return [];
    }

    const registerGroups = await this._apiInterface.getAllAvailableGroups(installationProfileId);

    if (!registerGroups) {
      return [];
    }

    return registerGroups.map(group => group.name);
  }

  async getAvailableRegistersForGroup(registerGroup) {
    const registersForGroup = await this._apiInterface.getRegisterGroupJson(this._deviceId, registerGroup);

    if (!registersForGroup) {
      return [];
    }

    return registersForGroup.map(register => register.registerName);
  }

  async getRegisterDataByRegisterGroupAndName(registerGroup, registerName) {
    const registerGroupData = await this._apiInterface.getRegisterGroupJson(this._deviceId, registerGroup);

    if (!registerGroupData) {
      this._logger.error(`No register group found for group: ${registerGroup}`);
      return null;
    }

    return this._getDataFromGroupByRegisterName(registerGroupData, registerName);
  }

  async setRegisterDataByRegisterGroupAndName(registerGroup, registerName, value) {
    const registerData = await this.getRegisterDataByRegisterGroupAndName(registerGroup, registerName);

    if (!registerData) {
      this._logger.error(
        `No register group found for group: ${registerGroup} and register: ${registerName}`
      );
      return null;
    }

    await this._apiInterface.setRegisterValue(this, registerData.id, value);
    await this.updateData();
  }

  _getHeatTemperatureData() {
    const deviceTemperatureRegisterIndex = this.getRegisterIndexes().temperature;
    if (!deviceTemperatureRegisterIndex) {
      return null;
    }

    if (!this._groupTemperatures) {
      return null;
    }

    const data = this._groupTemperatures.filter(d => d.registerId === deviceTemperatureRegisterIndex);

    if (data.length !== 1) {
      return null;
    }

    const tempData = data[0];

    return {
      minValue: tempData.minValue,
      maxValue: tempData.maxValue,
      step: tempData.step,
    };
  }

  _getTemperatureDataByRegisterName(registerName) {
    if (!this._groupTemperatures) {
      return null;
    }

    return this._getDataFromGroupByRegisterName(this._groupTemperatures, registerName);
  }

  _getOperationalTimeDataByRegisterName(registerName) {
    if (!this._groupOperationalTime) {
      return null;
    }

    return this._getDataFromGroupByRegisterName(this._groupOperationalTime, registerName);
  }

  _getDataFromGroupByRegisterName(group, registerName) {
    if (!group) {
      return null;
    }

    const data = group.filter(d => d.registerName === registerName);

    if (data.length !== 1) {
      return null;
    }

    const registerData = data[0];

    return {
      id: registerData.registerId,
      isReadOnly: registerData.isReadOnly,
      minValue: registerData.minValue,
      maxValue: registerData.maxValue,
      step: registerData.step,
      value: registerData.registerValue,
    };
  }

  _getActiveAlarms() {
    return (this._alarms || []).filter(alarm => getDictValueOrDefault(alarm, 'isActive', false));
  }

  _getOperationalStatusesFromOperationalStatus() {
    if (!this._groupOperationalStatus) {
      return [];
    }

    const statusReg = getDictValueOrNone(this._deviceConfig, 'operational_status_register');

    if (!statusReg) {
      return [];
    }

    return this._groupOperationalStatus.filter(op => op.registerId === statusReg);
  }

  _getAllOperationalStatusesFromOperationalStatus() {
    if (!this._status) {
      return [];
    }

    return new ChainMap(
      getDictValueOrDefault(this._status, 'operationalStatus', []),
      getDictValueOrDefault(this._status, 'availableOperationalStatus', [])
    );
  }

  _getAllVisibleOperationalStatusesFromOperationalStatus() {
    const visibleStatusIds = getDictValueOrNone(this._deviceConfig, 'visibleOperationalStatusIds');
    if (!visibleStatusIds) {
      return [];
    }

    return this._groupOperationalStatus.filter(op => visibleStatusIds.includes(op.registerId));
  }

  _getRunningOperationalStatuses() {
    if (!this._operationalStatuses) {
      return [];
    }

    return this._operationalStatuses.filter(op => getDictValueOrDefault(op, 'isActive', false));
  }

  get supplyLineTemperature() {
    return (
      getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_SUPPLY_LINE), 'value') ||
      getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_OPER_DATA_SUPPLY_MA_SA), 'value')
    );
  }

  get desiredSupplyLineTemperature() {
    return (
      getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_DESIRED_SUPPLY_LINE), 'value') ||
      getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_DESIRED_SUPPLY_LINE_TEMP), 'value') ||
      getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_DESIRED_SYS_SUPPLY_LINE_TEMP), 'value')
    );
  }

  get bufferTankTemperature() {
    return getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_OPER_DATA_BUFFER_TANK), 'value');
  }

  get returnLineTemperature() {
    return (
      getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_RETURN_LINE), 'value') ||
      getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_OPER_DATA_RETURN), 'value')
    );
  }

  get brineOutTemperature() {
    return getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_BRINE_OUT), 'value');
  }

  get poolTemperature() {
    return getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_ACTUAL_POOL_TEMP), 'value');
  }

  get brineInTemperature() {
    return getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_BRINE_IN), 'value');
  }

  get coolingTankTemperature() {
    return getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_COOL_SENSOR_TANK), 'value');
  }

  get coolingSupplyLineTemperature() {
    return getDictValueOrNone(this._getTemperatureDataByRegisterName(REG_COOL_SENSOR_SUPPLY), 'value');
  }

  get runningOperationalStatuses() {
    return this._runningOperationalStatuses || [];
  }

  get availableOperationalStatuses() {
    return this._visibleOperationalStatusesMap ? Object.values(this._visibleOperationalStatusesMap) : [];
  }

  get availableOperationalStatusesMap() {
    return this._visibleOperationalStatusesMap;
  }

  operationalStatusAuxiliaryHeater(kw) {
    return this._getValueByKeyAndRegisterNameFromOperationalStatus('COMP_POWER_STATUS', `COMP_VALUE_STEP_${kw}KW`);
  }

  get operationalStatusCompressorStatus() {
    return (
      this._visibleOperationalStatusesMap &&
      'COMPR' in this._visibleOperationalStatusesMap.values() &&
      this.runningOperationalStatuses.includes('COMPR')
    );
  }

  get operationalStatusBrinePumpStatus() {
    return (
      this._visibleOperationalStatusesMap &&
      'BRINEPUMP' in this._visibleOperationalStatusesMap.values() &&
      this.runningOperationalStatuses.includes('BRINEPUMP')
    );
  }

  get operationalStatusRadiatorPumpStatus() {
    return (
      this._visibleOperationalStatusesMap &&
      'RADIATORPUMP' in this._visibleOperationalStatusesMap.values() &&
      this.runningOperationalStatuses.includes('RADIATORPUMP')
    );
  }

  get operationalStatusCoolingStatus() {
    return (
      this._visibleOperationalStatusesMap &&
      'COOLING' in this._visibleOperationalStatusesMap.values() &&
      this.runningOperationalStatuses.includes('COOLING')
    );
  }

  get operationalStatusHotWaterStatus() {
    return (
      this._visibleOperationalStatusesMap &&
      'HOT_WATER' in this._visibleOperationalStatusesMap.values() &&
      this.runningOperationalStatuses.includes('HOT_WATER')
    );
  }

  get operationalStatusHeatingStatus() {
    return (
      this._visibleOperationalStatusesMap &&
      'HEATING' in this._visibleOperationalStatusesMap.values() &&
      this.runningOperationalStatuses.includes('HEATING')
    );
  }

  get operationalStatusIntegral() {
    const data = this._getRegisterFromOperationalStatus(REG_INTEGRAL_LSD);
    return getDictValueOrNone(data, 'registerValue');
  }

  get operationalStatusPid() {
    const data = this._getRegisterFromOperationalStatus(REG_PID);
    return getDictValueOrNone(data, 'registerValue');
  }

  get compressorOperationalTime() {
    return getDictValueOrNone(this._getOperationalTimeDataByRegisterName(REG_OPER_TIME_COMPRESSOR), 'value');
  }

  get hotWaterOperationalTime() {
    return getDictValueOrNone(this._getOperationalTimeDataByRegisterName(REG_OPER_TIME_HOT_WATER), 'value');
  }

  auxiliaryHeaterOperationalTime(heaterIndex) {
    return getDictValueOrNone(
      this._getOperationalTimeDataByRegisterName(`REG_OPER_TIME_IMM${heaterIndex}`),
      'value'
    );
  }
   get auxiliaryHeaterOperationalTime() {
    return this.auxiliaryHeaterOperationalTime(0);
  }

  get operationMode() {
    return getDictValueOrNone(this._groupOperationalOperation, 'current');
  }

  get availableOperationModes() {
    return Object.values(getDictValueOrDefault(this._groupOperationalOperation, 'available', {}));
  }

  get availableOperationModeMap() {
    return getDictValueOrDefault(this._groupOperationalOperation, 'available', {});
  }

  get isOperationModeReadOnly() {
    return getDictValueOrNone(this._groupOperationalOperation, 'isReadOnly');
  }

  get hotWaterSwitchState() {
    return this._groupHotWater.hot_water_switch;
  }

  get hotWaterBoostSwitchState() {
    return this._groupHotWater.hot_water_boost_switch;
  }

  get activeAlarmCount() {
    return this._getActiveAlarms().length;
  }

  get activeAlarms() {
    const activeAlarms = this._getActiveAlarms();
    return activeAlarms.map(alarm => alarm.eventTitle);
  }

  get historicalDataRegisters() {
    if (!this._historicalDataRegistersMap) {
      this._setHistoricalDataRegisters();
    }
    return Object.keys(this._historicalDataRegistersMap || {});
  }

  async getHistoricalDataForRegister(registerName, startDate, endDate) {
    if (!this._historicalDataRegistersMap) {
      this._setHistoricalDataRegisters();
    }

    const registerId = getDictValueOrNone(this._historicalDataRegistersMap, registerName);

    if (!registerId) {
      this._logger.error(`Register name is not supported: ${registerName}`);
      return null;
    }

    const historicalData = await this._apiInterface.getHistoricalData(
      this._deviceId,
      registerId,
      formatDateTime(startDate, DATETIME_FORMAT),
      formatDateTime(endDate, DATETIME_FORMAT)
    );

    if (!historicalData || !historicalData.data) {
      return [];
    }

    return historicalData.data.map(entry => ({
      time: parseDateTime(entry.at.split('.')[0], DATETIME_FORMAT, new Date()),
      value: parseInt(entry.val, 10),
    }));
  }

  debug() {
    console.log('Creating debug file');

    const originalStdout = process.stdout;
    const f = fs.createWriteStream('debug.txt');
    process.stdout = f;

    console.log('########## DEBUG START ##########');

    console.log('this._info:');
    prettyPrintExcept(this._info, [
      'address',
      'macAddress',
      'ownerId',
      'retailerAccess',
      'retailerId',
      'timeZoneId',
      'id',
      'hasUserAccount',
    ]);

    console.log('this._status:');
    prettyPrintExcept(this._status);

    console.log('this._device_data:');
    prettyPrintExcept(this._deviceData, ['macAddress', 'owner', 'retailerAccess', 'retailerId', 'id', 'status']);

    console.log('this._group_temperatures:');
    prettyPrintExcept(this._groupTemperatures);

    const installationProfileId = getDictValueOrNone(this._info, 'installationProfileId');

    if (installationProfileId) {
      const allAvailableGroups = this._apiInterface.getAllAvailableGroups(installationProfileId);
      if (allAvailableGroups) {
        console.log('All available groups:');
        prettyPrintExcept(allAvailableGroups);

        allAvailableGroups.forEach(group => {
          const groupName = group.name;
          if (groupName) {
            console.log(`Group ${groupName}:`);
            const groupData = this._apiInterface.getRegisterGroupJson(this._deviceId, groupName);
            prettyPrintExcept(groupData);
          }
        });
      }
    }

    console.log('########## DEBUG END ##########');

    process.stdout = originalStdout;
    f.end();
    console.log('Debug file created');
  }
}

module.exports = ThermiaHeatPump;
