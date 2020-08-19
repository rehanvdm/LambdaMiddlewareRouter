const MiddlewareBase = require('./MiddlewareBase');
const LambdaEvents = require('./../helpers/lambda_events');
const LambdaLog = require('./../helpers/lambda_log');

const logger = new LambdaLog();

class MiddlewareRequest extends MiddlewareBase
{
    constructor(debug = false)
    {
        super();
        this.debug = debug;
    }
    async before({event, context, request, response, auditRecord, error})
    {
        this.debug && logger.debug("/middleware/MiddlewareRequest.before");

        request = LambdaEvents.API_GATEWAY__PROXY(event);
        // if( process.env.ENVIRONMENT === "prod") /* Log anonymized info */
        //     logger.log("Request", { HttpMethod: request.HttpMethod, Path: request.Path, Authorization: request.Authorization, QueryString: request.QueryString });
        // else
            logger.log("Request", request);

        try { request.Body = JSON.parse(request.Body); } catch (e) { request.Body = null; }

        /* Remove trailing slash if have from /v1/ping */
        if(request.Path.endsWith('/'))
            request.Path = request.Path.substring(0,request.Path.length-1);

        auditRecord.origin_path = request.Path;
        auditRecord.meta = request.HttpMethod;

        return {event, context, request, response, auditRecord, error};
    }

    async after({event, context, request, response, auditRecord, error})
    {
        this.debug && logger.debug("/middleware/MiddlewareRequest.after");
    }
}

module.exports = MiddlewareRequest;