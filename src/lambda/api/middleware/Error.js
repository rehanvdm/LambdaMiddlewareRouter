const moment = require('moment');

const MiddlewareBase = require('./MiddlewareBase');
const LambdaError = require('./../helpers/lambda_errors');
const LambdaResponse = require('./../helpers/lambda_response');
const LambdaLog = require('./../helpers/lambda_log');

const logger = new LambdaLog();

class MiddlewareError extends MiddlewareBase
{
    constructor(debug = false)
    {
        super();
        this.debug = debug;
    }
    async before({event, context, request, response, auditRecord, error})
    {
        this.debug && logger.debug("/middleware/MiddlewareError.before");


    }

    async after({event, context, request, response, auditRecord, error})
    {
        this.debug && logger.debug("/middleware/MiddlewareError.after");

        if(error)
        {
            console.error(error);
            logger.error(error);

            auditRecord.status = false;
            auditRecord.raise_alarm = true; /* Later do sampling */
            auditRecord.status_description = error.message;

            let extraControl = { "TraceID": logger.getTraceId() };

            if(error instanceof LambdaError.HandledError)
            {
                auditRecord.status_code = 5001;
                response = LambdaResponse.API_GATEWAY(auditRecord.status_code, auditRecord.status_description, extraControl);
            }
            else if(error instanceof LambdaError.ValidationError)
            {
                auditRecord.status_code = 5002;
                response = LambdaResponse.API_GATEWAY(auditRecord.status_code, auditRecord.status_description, extraControl);
            }
            else if(error instanceof LambdaError.AuthError)
            {
                auditRecord.status_code = 3001;
                response = LambdaResponse.API_GATEWAY(auditRecord.status_code, auditRecord.status_description, extraControl);
            }
            else
            {
                auditRecord.status_code = 5000;
                response = LambdaResponse.API_GATEWAY(auditRecord.status_code, "Unexpected Error Occurred", extraControl); /* Not a safe error to return to caller */
            }
        }

        return {event, context, request, response, auditRecord, error};
    }
}

module.exports = MiddlewareError;