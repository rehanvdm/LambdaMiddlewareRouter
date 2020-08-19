const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

const LambdaError = require('../../helpers/lambda_errors');
const LambdaLog = require('../../helpers/lambda_log');
const logger = new LambdaLog();

const index = require('../../data_schema/person.js');
const DynamoPerson = require('../../dynamo/Person.js');

const ApiBaseClass = require('./../ApiBaseClass');

class Person extends ApiBaseClass
{
    constructor(aws, awsXray)
    {
        super();

        this.dynamo = new aws.DynamoDB({apiVersion: '2012-08-10', maxRetries: 6, retryDelayOptions: { base: 50} });
        this.dynPerson = new DynamoPerson(this.dynamo, process.env.DYNAMO_TABLE);
    }

    async POST(request, auditRecord)
    {
        if(!request.Body.client_id)
            throw new LambdaError.ValidationError("Field: client_id is required");
        if(!request.Body.name || request.Body.name.length > 50)
            throw new LambdaError.ValidationError("Field: name is required and can not be longer than 50 characters");
        if(!request.Body.email || !request.Body.email.length > 1024)
            throw new LambdaError.ValidationError("Field: email is required and can not be longer than 1024 characters");

        let now = moment().utc().format("YYYY-MM-DD HH:mm:ss.SSS");
        let newPerson = new index(uuidv4(), request.Body.client_id, request.Body.name, request.Body.email, now);

        await this.dynPerson.Put(newPerson);

        return this.MethodReturn(newPerson);
    };

    async GET(request, auditRecord)
    {
        if(!request.QueryString.limit || request.QueryString.limit > 100)
            throw new LambdaError.ValidationError("Field: limit is required and can not be more than 100");

        let ret = await this.dynPerson.FindFirst(request.QueryString.limit);

        return this.MethodReturn(ret.data);
    };
}

module.exports = Person;
