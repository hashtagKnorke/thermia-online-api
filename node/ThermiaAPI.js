const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const crypto = require('crypto');
const qs = require('querystring');
const { DateTime } = require('luxon');

const {
    REG_GROUP_HOT_WATER,
    REG_GROUP_OPERATIONAL_OPERATION,
    REG_GROUP_OPERATIONAL_STATUS,
    REG_GROUP_OPERATIONAL_TIME,
    REG_GROUP_TEMPERATURES,
    REG_HOT_WATER_STATUS,
    REG__HOT_WATER_BOOST,
    REG_OPERATIONMODE,
    THERMIA_API_CONFIG_URLS_BY_API_TYPE,
    THERMIA_AZURE_AUTH_URL,
    THERMIA_AZURE_AUTH_CLIENT_ID_AND_SCOPE,
    THERMIA_AZURE_AUTH_REDIRECT_URI,
    THERMIA_INSTALLATION_PATH,
} = require('./ThermiaOnlineAPIConst');

const AuthenticationException = require('./exceptions/AuthenticationException');
const NetworkException = require('./exceptions/NetworkException');
const ThermiaHeatPump = require('./ThermiaHeatPump');
const utils = require('./utils/utils');

const _LOGGER = console;

const AZURE_AUTH_AUTHORIZE_URL = `${THERMIA_AZURE_AUTH_URL}/oauth2/v2.0/authorize`;
const AZURE_AUTH_GET_TOKEN_URL = `${THERMIA_AZURE_AUTH_URL}/oauth2/v2.0/token`;
const AZURE_SELF_ASSERTED_URL = `${THERMIA_AZURE_AUTH_URL}/SelfAsserted`;
const AZURE_AUTH_CONFIRM_URL = `${THERMIA_AZURE_AUTH_URL}/api/CombinedSigninAndSignup/confirmed`;

const azure_auth_request_headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
};

axiosRetry(axios, { retries: 20, retryDelay: axiosRetry.exponentialDelay });

class ThermiaAPI {
    constructor(email, password, apiType) {
        this.email = email;
        this.password = password;
        this.token = null;
        this.tokenValidTo = null;
        this.refreshTokenValidTo = null;
        this.refreshToken = null;

        this.defaultRequestHeaders = {
            'Authorization': 'Bearer ',
            'Content-Type': 'application/json',
            'cache-control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
        };

        if (!THERMIA_API_CONFIG_URLS_BY_API_TYPE[apiType]) {
            throw new Error(`Unknown device type: ${apiType}`);
        }

        this.apiConfigUrl = THERMIA_API_CONFIG_URLS_BY_API_TYPE[apiType];

        this.configuration = this.fetchConfiguration();
        this.authenticated = this.authenticate();
    }

    async fetchConfiguration() {
        try {
            const response = await axios.get(this.apiConfigUrl);
            return response.data;
        } catch (error) {
            _LOGGER.error(`Error fetching API configuration. Status: ${error.response.status}, Response: ${error.response.data}`);
            throw new NetworkException('Error fetching API configuration.', error.response.status);
        }
    }

    async authenticate() {
        const refreshAzureToken = this.refreshTokenValidTo && (this.refreshTokenValidTo > DateTime.now().toSeconds());

        let requestTokenText = null;

        if (refreshAzureToken) {
            requestTokenText = await this.authenticateRefreshToken();
        }

        if (!requestTokenText) {
            const codeChallenge = utils.generateChallenge(43);

            const requestAuthData = {
                client_id: THERMIA_AZURE_AUTH_CLIENT_ID_AND_SCOPE,
                scope: THERMIA_AZURE_AUTH_CLIENT_ID_AND_SCOPE,
                redirect_uri: THERMIA_AZURE_AUTH_REDIRECT_URI,
                response_type: 'code',
                code_challenge: utils.base64UrlEncode(crypto.createHash('sha256').update(codeChallenge).digest()),
                code_challenge_method: 'S256',
            };

            let requestAuth;
            try {
                requestAuth =  axios.get(AZURE_AUTH_AUTHORIZE_URL, { params: requestAuthData });
            } catch (error) {
                _LOGGER.error(`Error fetching authorization API. Status: ${error.response.status}, Response: ${error.response.data}`);
                throw new NetworkException('Error fetching authorization API.', error.response.status);
            }

            const settingsString = requestAuth.data.split('var SETTINGS = ')[1].split('};')[0] + '}';
            const settings = JSON.parse(settingsString);
            const stateCode = settings.transId.split('=')[1];
            const csrfToken = settings.csrf;

            const requestSelfAssertedData = {
                request_type: 'RESPONSE',
                signInName: this.email,
                password: this.password,
            };

            const requestSelfAssertedParams = {
                tx: `StateProperties=${stateCode}`,
                p: 'B2C_1A_SignUpOrSigninOnline',
            };

            let requestSelfAsserted;
            try {
                requestSelfAsserted = await axios.post(AZURE_SELF_ASSERTED_URL, qs.stringify(requestSelfAssertedData), {
                    headers: { ...azure_auth_request_headers, 'X-Csrf-Token': csrfToken },
                    params: requestSelfAssertedParams,
                });
            } catch (error) {
                _LOGGER.error(`Error in API authentication. Wrong credentials ${error.response.data}`);
                throw new NetworkException('Error in API authentication. Wrong credentials', error.response.data);
            }

            const requestConfirmedCookies = requestSelfAsserted.headers['set-cookie'];
            const requestConfirmedParams = {
                csrf_token: csrfToken,
                tx: `StateProperties=${stateCode}`,
                p: 'B2C_1A_SignUpOrSigninOnline',
            };

            const requestConfirmed = await axios.get(AZURE_AUTH_CONFIRM_URL, {
                headers: { Cookie: requestConfirmedCookies.join('; ') },
                params: requestConfirmedParams,
            });

            const requestTokenData = {
                client_id: THERMIA_AZURE_AUTH_CLIENT_ID_AND_SCOPE,
                redirect_uri: THERMIA_AZURE_AUTH_REDIRECT_URI,
                scope: THERMIA_AZURE_AUTH_CLIENT_ID_AND_SCOPE,
                code: requestConfirmed.request.res.responseUrl.split('code=')[1],
                code_verifier: codeChallenge,
                grant_type: 'authorization_code',
            };

            const requestToken = await axios.post(AZURE_AUTH_GET_TOKEN_URL, qs.stringify(requestTokenData), {
                headers: azure_auth_request_headers,
            });

            if (requestToken.status !== 200) {
                const errorText = `Authentication request failed, please check credentials. Status: ${requestToken.status}, Response: ${requestToken.data}`;
                _LOGGER.error(errorText);
                throw new AuthenticationException(errorText);
            }

            requestTokenText = requestToken.data;
        }

        const tokenData = this.parseTokenData(requestTokenText);

        if (!tokenData) {
            return false;
        }

        this.updateTokenData(tokenData);

        return true;
    }

    parseTokenData(requestTokenText) {
        try {
            return JSON.parse(requestTokenText);
        } catch (error) {
            return null;
        }
    }

    updateTokenData(tokenData) {
        this.token = tokenData.access_token;
        this.tokenValidTo = tokenData.expires_on;

        this.refreshTokenValidTo = DateTime.now().plus({ hours: 6 }).toSeconds();
        this.refreshToken = tokenData.refresh_token;

        this.defaultRequestHeaders['Authorization'] = `Bearer ${this.token}`;
    }

    async authenticateRefreshToken() {
        const requestTokenData = {
            client_id: THERMIA_AZURE_AUTH_CLIENT_ID_AND_SCOPE,
            redirect_uri: THERMIA_AZURE_AUTH_REDIRECT_URI,
            scope: THERMIA_AZURE_AUTH_CLIENT_ID_AND_SCOPE,
            refresh_token: this.refreshToken,
            grant_type: 'refresh_token',
        };

        try {
            const requestToken = await axios.post(AZURE_AUTH_GET_TOKEN_URL, qs.stringify(requestTokenData), {
                headers: azure_auth_request_headers,
            });
            return requestToken.data;
        } catch (error) {
            this.refreshToken = null;
            this.refreshTokenValidTo = null;
            _LOGGER.info(`Reauthentication request failed with previous refresh token. Status: ${error.response.status}, Response: ${error.response.data}`);
            return null;
        }
    }

    async checkTokenValidity() {
        if (
            !this.tokenValidTo ||
            this.tokenValidTo < DateTime.now().toSeconds() ||
            !this.refreshTokenValidTo ||
            this.refreshTokenValidTo < DateTime.now().toSeconds()
        ) {
            _LOGGER.info('Token expired, re-authenticating.');
            this.authenticated = await this.authenticate();
        }
    }

    async getDevices() {
        await this.checkTokenValidity();

        const url = `${this.configuration.apiBaseUrl}/api/v1/InstallationsInfo/own`;
        try {
            const response = await axios.get(url, { headers: this.defaultRequestHeaders });
            return response.data;
        } catch (error) {
            _LOGGER.error(`Error fetching devices. Status: ${error.response.status}, Response: ${error.response.data}`);
            return [];
        }
    }

    async getDeviceById(deviceId) {
        await this.checkTokenValidity();

        const devices = await this.getDevices();

        const device = devices.find(d => String(d.id) === deviceId);

        if (!device) {
            _LOGGER.error(`Error getting device by id: ${deviceId}`);
            return null;
        }

        return device;
    }

    async getDeviceInfo(deviceId) {
        await this.checkTokenValidity();

        const url = `${this.configuration.apiBaseUrl}/api/v1/installations/${deviceId}`;
        try {
            const response = await axios.get(url, { headers: this.defaultRequestHeaders });
            return response.data;
        } catch (error) {
            _LOGGER.error(`Error fetching device information. Status: ${error.response.status}, Response: ${error.response.data}`);
            return [];
        }
    }

    async getDeviceByName(deviceName) {
        await this.checkTokenValidity();

        const devices = await this.getDevices();

        const device = devices.find(d => d.name === deviceName);

        if (!device) {
            _LOGGER.error(`Error getting device by name: ${deviceName}`);
            return null;
        }

        return device;
    }

    async getHeatPump(deviceId) {
        await this.checkTokenValidity();

        const device = await this.getDeviceById(deviceId);

        const url = `${this.configuration.apiBaseUrl}${THERMIA_INSTALLATION_PATH}/${device.serialNumber}/regdata`;
        const params = {
            groups: [
                REG_GROUP_HOT_WATER,
                REG_GROUP_OPERATIONAL_OPERATION,
                REG_GROUP_OPERATIONAL_STATUS,
                REG_GROUP_OPERATIONAL_TIME,
                REG_GROUP_TEMPERATURES,
            ].join(','),
        };

        try {
            const response = await axios.get(url, { headers: this.defaultRequestHeaders, params });
            const jsonData = response.data;

            const regDataMap = new ChainMap();
            jsonData.forEach(data => {
                regDataMap.set(String(data.regAddress), data);
            });

            const heatPump = new ThermiaHeatPump(
                device.serialNumber,
                regDataMap.get(REG_HOT_WATER_STATUS).value === 1,
                regDataMap.get(REG__HOT_WATER_BOOST).value === 1,
                regDataMap.get(REG_OPERATIONMODE).value,
            );

            heatPump.updateWithRegDataMap(regDataMap);

            return heatPump;
        } catch (error) {
            _LOGGER.error(`Error fetching device information. Status: ${error.response.status}, Response: ${error.response.data}`);
            return null;
        }
    }

    async getHeatPumpByName(deviceName) {
        await this.checkTokenValidity();

        const device = await this.getDeviceByName(deviceName);

        if (!device) {
            _LOGGER.error(`Error fetching device information: ${deviceName}`);
            return null;
        }

        return await this.getHeatPump(device.id);
    }
}

module.exports = ThermiaAPI;
