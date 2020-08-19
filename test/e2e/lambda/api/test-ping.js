'use strict';
const chai = require('chai');
const expect = chai.expect;

var resolve = require('path').resolve;
const Helper = require('../../../_helpers/lambda_app.js');
const Events = require('../../../_events/events.js');
var events = new Events();
var helper = new Helper();

let TimeOut = 30;

helper.TestAgainst = Helper.TEST_AGAINST__DEPLOYED;

describe('Test Ping Pong', function ()
{
    beforeEach(async function()
    {
        await helper.SetEnvironmentVariables("prod", "1.0.0", "1", "25",
                                            "false", "true", "5000");
    });

    it('Returns Pong', async function()
    {
        let result;

        let method = "GET";
        let resource = '/v1/ping';
        let path = '/v1/ping';
        let body = null;
        let pathParams = null;
        let queryParams = null;

        console.log("Testing against:", Helper.TEST_AGAINST__DEPLOYED);
        if(helper.TestAgainst === Helper.TEST_AGAINST__DEVELOPMENT)
        {
            this.timeout(TimeOut*1000);

            let event = events.API_GATEWAY_HTTP_REQUEST(method, resource, path,  pathParams, queryParams, body, null,null, null);

            let app = helper.RequireLambdaFunction(resolve('../src/lambda/api/'), 'app.js');
            result = await app.handler(event, helper.LambdaContext(128, TimeOut));
        }
        else if(helper.TestAgainst === Helper.TEST_AGAINST__DEPLOYED) /* Do specific API Call against AWS Resources after deployment */
        {
            this.timeout(TimeOut*1000);

            result = await helper.API_REQUEST(method, Helper.API_URL, path,
                body ? JSON.stringify(body) : null, queryParams, null, null);
        }

        expect(result).to.be.an('object');
        expect(result.statusCode).to.equal(200);
        expect(result.body).to.be.an('string');

        let response = JSON.parse(result.body);

        expect(response).to.be.an('object');
        expect(response.control.ResponseCode).to.be.equal(2000);
        expect(response.data).to.be.equal("pong");
    });
});


