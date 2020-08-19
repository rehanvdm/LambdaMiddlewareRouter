const LambdaLog = require('./helpers/lambda_log');
const LambdaResponse = require('./helpers/lambda_response');

const awsXray = require('aws-xray-sdk-core');
const aws =  awsXray.captureAWS(require('aws-sdk'));
aws.config.region = 'us-east-1';

const logger = new LambdaLog();
logger.init(process.env.ENVIRONMENT);

const MiddleWareAuditLog = require('./middleware/AuditLog');
const MiddleWareRequest = require('./middleware/Request');
const MiddleWareError = require('./middleware/Error');

async function router({event, context, request, response, auditRecord, error})
{
    let apiClass;

    /* Create an instance of the business logic class */
    apiClass = new (require('.'+request.Path+'/index.js'))(aws, awsXray);
    /* Execute the method on that class that corresponds to the HTTP Method of the request */
    let reqResp = await apiClass[request.HttpMethod](request, auditRecord);

    /* Add extra data to control if the function returned it, always add the trace id */
    reqResp.control = Object.assign(reqResp.control ? reqResp.control : {}, {"TraceID": logger.getTraceId()});
    /* Function can also change the audit record if it wants too */
    if(reqResp.auditRecord)
        auditRecord = reqResp.auditRecord;

    auditRecord.status = true;
    auditRecord.status_code = 2000; /* All successful calls will have this code */
    response = LambdaResponse.API_GATEWAY(auditRecord.status_code, reqResp.body, reqResp.control);

    return {event, context, request, response, auditRecord};
}

exports.handler = async (event, context) =>
{
    logger.setTraceId(context.awsRequestId);
    logger.log("Init", process.env.ENVIRONMENT, process.env.VERSION, process.env.BUILD);

    let debug = true;
    let middleWares = [
        new MiddleWareError(debug),
        new MiddleWareAuditLog("LambdaMiddlewareRouter::api",debug),
        new MiddleWareRequest(debug)
    ];
    let middleWaresExecuting = [];

    let handler = { event, context, request: {}, response: {}, auditRecord: {}, error: null };

    for(let middleWare of middleWares)
    {
        middleWaresExecuting.push(middleWare);
        let retHandler = await middleWare.before(handler).catch(err => Object.assign(handler, {error: err}));

        if(retHandler)
        {
            if(retHandler.error !== null) /* Don't continue with middleware */
                break;

            handler = retHandler;
        }
    }

    if(handler.error === null) /* Only if all middleware.before was successful */
        handler = await router(handler).catch(err => Object.assign(handler, {error: err}));

    for(let middleWare of middleWaresExecuting.reverse()) /* Only iterate those that have been iterated */
    {
        /* Overwrites previous error if have */
        let retHandler = await middleWare.after(handler).catch(err => Object.assign(handler, {error: err}));

        if(retHandler)
            handler = retHandler;
    }


    logger.info(handler.response);
    return handler.response;
}

