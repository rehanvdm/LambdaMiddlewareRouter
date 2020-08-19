const ApiBaseClass = require('./../ApiBaseClass');

class PingPong extends ApiBaseClass
{
    constructor(aws, awsXray)
    {
        super(aws, awsXray);
    }

    async GET(request, auditRecord)
    {
        return this.MethodReturn("pong");
    }
}

module.exports = PingPong;
