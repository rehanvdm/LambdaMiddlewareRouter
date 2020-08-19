const moment = require('moment');

const MiddlewareBase = require('./MiddlewareBase');
const audit_log = require('./../data_schema/audit_log');
const LambdaLog = require('./../helpers/lambda_log');

const logger = new LambdaLog();

class MiddlewareAuditLog extends MiddlewareBase
{
    constructor(origin, debug = false)
    {
        super();
        this.origin = origin;
        this.debug = debug;
    }
    async before({event, context, request, response, auditRecord, error})
    {
        this.debug && logger.debug("/middleware/MiddlewareAuditLog.before");

        auditRecord = new audit_log(audit_log.GetNewID(), logger.getTraceId(), null,
            null, null, null, null,
            null, "api", this.origin, null,
            null, moment().utc().format("YYYY-MM-DD HH:mm:ss.SSS"), null,
            process.env.ENVIRONMENT, process.env.VERSION, process.env.BUILD);

        return {event, context, request, response, auditRecord, error};
    }

    async after({event, context, request, response, auditRecord, error})
    {
        this.debug && logger.debug("/middleware/MiddlewareAuditLog.after");

        auditRecord.run_time = ((process.env.TIMEOUT*1000) -  context.getRemainingTimeInMillis());
        logger.audit(true, auditRecord);
    }
}

module.exports = MiddlewareAuditLog;