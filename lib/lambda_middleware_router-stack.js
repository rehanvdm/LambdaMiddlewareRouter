"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("@aws-cdk/core");
const lambda = require("@aws-cdk/aws-lambda");
const dynamodb = require("@aws-cdk/aws-dynamodb");
const apigateway = require("@aws-cdk/aws-apigateway");
const logs = require("@aws-cdk/aws-logs");
const cloudwatch = require("@aws-cdk/aws-cloudwatch");
const sns = require("@aws-cdk/aws-sns");
const cloudwatchactions = require("@aws-cdk/aws-cloudwatch-actions");
class LambdaMiddlewareRouterStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        let dynTable = new dynamodb.Table(this, id + "-table", {
            tableName: id + "-table",
            partitionKey: {
                name: 'PK',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'SK',
                type: dynamodb.AttributeType.STRING
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        let environment = "prod";
        let lambdaTimeout = 25;
        let apiLambda = new lambda.Function(this, id + "-lambda", {
            functionName: id + "-lambda",
            code: new lambda.AssetCode('./src/lambda/api/'),
            handler: 'app.handler',
            runtime: lambda.Runtime.NODEJS_12_X,
            timeout: cdk.Duration.seconds(lambdaTimeout),
            reservedConcurrentExecutions: 10,
            environment: {
                ENVIRONMENT: environment,
                VERSION: "1.0.0",
                BUILD: "1",
                TIMEOUT: "" + lambdaTimeout,
                ENABLE_CHAOS: "false",
                INJECT_ERROR: "true",
                INJECT_LATENCY: "5000",
                DYNAMO_TABLE: dynTable.tableName
            },
            tracing: lambda.Tracing.ACTIVE
        });
        dynTable.grantReadWriteData(apiLambda);
        let apiName = id;
        let api = new apigateway.RestApi(this, id + "-api", {
            restApiName: id,
            deployOptions: {
                stageName: environment,
                dataTraceEnabled: true,
                tracingEnabled: true,
                loggingLevel: apigateway.MethodLoggingLevel.OFF
            },
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ["*"]
            },
        });
        api.root.addProxy({
            defaultIntegration: new apigateway.LambdaIntegration(apiLambda),
            anyMethod: true,
        });
        new cdk.CfnOutput(this, 'DYNAMO_TABLE', { value: dynTable.tableName });
        new cdk.CfnOutput(this, 'API_URL', { value: api.url });
        /* ==========================================================================================================
           =================================== Logging, Alarms & Dashboard ==========================================
           ========================================================================================================== */
        const alarmTopic = new sns.Topic(this, id + "alarm-topic", {
            topicName: id + "alarm-topic",
            displayName: id + "alarm-topic",
        });
        const cwAlarmAction = new cloudwatchactions.SnsAction(alarmTopic);
        function MetricToAlarmName(metric) {
            let dim1Val = null;
            if (metric.toAlarmConfig().dimensions) {
                let dimensions = metric.toAlarmConfig().dimensions ? metric.toAlarmConfig().dimensions : [];
                if (dimensions.length > 0)
                    dim1Val = dimensions[0].value;
            }
            return id + "::" + [metric.namespace, metric.metricName, dim1Val].join('/');
        }
        function SoftErrorLambdaMetricFilterAlarm(scope, metricName, filterPattern, lambdaFunction, cwAlarmAction) {
            const METRIC_NAMESPACE = 'LogMetrics/Lambda';
            let safeConstructId = lambdaFunction.node.id + "-" + metricName.replace(/\//gm, '-');
            /* LogMetricFilters do not take into account Dimension, so creating a namespace with metricname */
            const metric = new cloudwatch.Metric({
                namespace: METRIC_NAMESPACE + "/" + metricName,
                metricName: lambdaFunction.node.id,
            });
            //@ts-ignore
            let filter = new logs.MetricFilter(scope, safeConstructId + 'Filter', {
                metricName: metric.metricName,
                metricNamespace: metric.namespace,
                logGroup: lambdaFunction.logGroup,
                filterPattern: filterPattern,
                metricValue: "1"
            });
            let alarm = new cloudwatch.Alarm(scope, safeConstructId + 'Alarm', {
                metric: metric,
                actionsEnabled: true,
                alarmName: MetricToAlarmName(metric),
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                threshold: 1,
                period: cdk.Duration.minutes(1),
                evaluationPeriods: 1,
                statistic: "Sum",
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
            });
            alarm.addAlarmAction(cwAlarmAction);
            alarm.addOkAction(cwAlarmAction);
            return alarm; //[metric, filter, alarm]
        }
        let apiLambdaAlarm_HandledError = SoftErrorLambdaMetricFilterAlarm(this, 'Errors/HandledError', logs.FilterPattern.all(logs.FilterPattern.stringValue("$.level", "=", "audit"), logs.FilterPattern.booleanValue("$.args.status", false), logs.FilterPattern.booleanValue("$.args.raise_alarm", true), logs.FilterPattern.stringValue("$.args.status_code", "=", "5001")), apiLambda, cwAlarmAction);
        let apiLambdaAlarm_ValidationError = SoftErrorLambdaMetricFilterAlarm(this, 'Errors/ValidationError', logs.FilterPattern.all(logs.FilterPattern.stringValue("$.level", "=", "audit"), logs.FilterPattern.booleanValue("$.args.status", false), logs.FilterPattern.booleanValue("$.args.raise_alarm", true), logs.FilterPattern.stringValue("$.args.status_code", "=", "5002")), apiLambda, cwAlarmAction);
        let apiLambdaAlarm_AuthError = SoftErrorLambdaMetricFilterAlarm(this, 'Errors/AuthError', logs.FilterPattern.all(logs.FilterPattern.stringValue("$.level", "=", "audit"), logs.FilterPattern.booleanValue("$.args.status", false), logs.FilterPattern.booleanValue("$.args.raise_alarm", true), logs.FilterPattern.stringValue("$.args.status_code", "=", "3001")), apiLambda, cwAlarmAction);
        let apiLambdaAlarm_UnexpectedError = SoftErrorLambdaMetricFilterAlarm(this, 'Errors/UnexpectedError', logs.FilterPattern.all(logs.FilterPattern.stringValue("$.level", "=", "audit"), logs.FilterPattern.booleanValue("$.args.status", false), logs.FilterPattern.booleanValue("$.args.raise_alarm", true), logs.FilterPattern.stringValue("$.args.status_code", "=", "5000")), apiLambda, cwAlarmAction);
        let apiLambdaAlarmHardError = new cloudwatch.Alarm(this, id + "ApiHardErrorAlarm", {
            metric: apiLambda.metricErrors(),
            actionsEnabled: true,
            alarmName: MetricToAlarmName(apiLambda.metricErrors()),
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            threshold: 1,
            period: cdk.Duration.minutes(1),
            evaluationPeriods: 1,
            statistic: "Sum",
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
        });
        apiLambdaAlarmHardError.addAlarmAction(cwAlarmAction);
        apiLambdaAlarmHardError.addOkAction(cwAlarmAction);
        let apiMetricCount = new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: 'Count',
            dimensions: { ApiName: apiName }
        });
        let apiAlarmHighUsage = new cloudwatch.Alarm(this, id + "ApiGatewayHeavyUsage", {
            metric: apiMetricCount,
            actionsEnabled: true,
            alarmName: MetricToAlarmName(apiMetricCount),
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            threshold: 100,
            period: cdk.Duration.minutes(1),
            evaluationPeriods: 3,
            statistic: "Sum",
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
        });
        apiAlarmHighUsage.addAlarmAction(cwAlarmAction);
        apiAlarmHighUsage.addOkAction(cwAlarmAction);
        let dashboard = new cloudwatch.Dashboard(this, id + '-dashboard', {
            dashboardName: id,
            start: "-PT24H",
            periodOverride: cloudwatch.PeriodOverride.AUTO
        });
        dashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '# Lambda Metrics',
            width: 24
        }));
        dashboard.addWidgets(new cloudwatch.Row(new cloudwatch.GraphWidget({
            title: "Lambda Hard Errors", left: [
                new cloudwatch.Metric({
                    label: 'api',
                    namespace: "AWS/Lambda",
                    metricName: 'Errors',
                    dimensions: { FunctionName: apiLambda.functionName },
                    statistic: "Sum",
                }),
            ]
        }), new cloudwatch.GraphWidget({
            title: "Lambda Invocations",
            left: [
                new cloudwatch.Metric({
                    label: 'api - Invocations',
                    namespace: "AWS/Lambda",
                    metricName: 'Invocations',
                    dimensions: { FunctionName: apiLambda.functionName },
                    statistic: "Sum",
                }),
                new cloudwatch.Metric({
                    label: 'api - ConcurrentExecutions',
                    namespace: "AWS/Lambda",
                    metricName: 'ConcurrentExecutions',
                    dimensions: { FunctionName: apiLambda.functionName },
                    statistic: "Maximum",
                }),
            ],
        }), new cloudwatch.GraphWidget({
            title: "Lambda Duration",
            left: [
                new cloudwatch.Metric({
                    label: "api - p95",
                    namespace: "AWS/Lambda",
                    metricName: 'Duration',
                    dimensions: { FunctionName: apiLambda.functionName },
                    statistic: "p95"
                }),
                new cloudwatch.Metric({
                    label: "api - avg",
                    namespace: "AWS/Lambda",
                    metricName: 'Duration',
                    dimensions: { FunctionName: apiLambda.functionName },
                    statistic: "Average"
                }),
                new cloudwatch.Metric({
                    label: "api - max",
                    namespace: "AWS/Lambda",
                    metricName: 'Duration',
                    dimensions: { FunctionName: apiLambda.functionName },
                    statistic: "Maximum"
                }),
            ],
        }), new cloudwatch.GraphWidget({
            title: "API Lambda Soft Errors",
            left: [
                apiLambdaAlarm_HandledError.metric,
                apiLambdaAlarm_ValidationError.metric,
                apiLambdaAlarm_AuthError.metric,
                apiLambdaAlarm_UnexpectedError.metric,
            ],
        })));
        dashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '# API Metrics',
            width: 24
        }));
        dashboard.addWidgets(new cloudwatch.Row(new cloudwatch.AlarmWidget({ title: "API High Usage", alarm: apiAlarmHighUsage }), new cloudwatch.GraphWidget({
            title: "API Duration",
            left: [
                new cloudwatch.Metric({
                    namespace: "AWS/ApiGateway",
                    metricName: 'Latency',
                    dimensions: { ApiName: apiName },
                    statistic: "p95",
                    label: "p95"
                }),
                new cloudwatch.Metric({
                    namespace: "AWS/ApiGateway",
                    metricName: 'Latency',
                    dimensions: { ApiName: apiName },
                    statistic: "Average",
                    label: "Average"
                }),
                new cloudwatch.Metric({
                    namespace: "AWS/ApiGateway",
                    metricName: 'Latency',
                    dimensions: { ApiName: apiName },
                    statistic: "Maximum",
                    label: "Maximum"
                }),
            ],
        }), new cloudwatch.GraphWidget({
            title: "API HTTP Errors",
            left: [
                new cloudwatch.Metric({
                    namespace: "AWS/ApiGateway",
                    metricName: '5XXError',
                    dimensions: { ApiName: apiName },
                    statistic: "Sum",
                }),
                new cloudwatch.Metric({
                    namespace: "AWS/ApiGateway",
                    metricName: '4XXError',
                    dimensions: { ApiName: apiName },
                    statistic: "Sum",
                }),
            ],
        })));
        dashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '# Dynamo',
            width: 24
        }));
        dashboard.addWidgets(new cloudwatch.Row(new cloudwatch.GraphWidget({
            title: "Dynamo Capacity",
            left: [
                new cloudwatch.Metric({
                    label: "RCU",
                    namespace: "AWS/DynamoDB",
                    metricName: 'ConsumedReadCapacityUnits',
                    dimensions: { TableName: dynTable.tableName },
                    statistic: "Sum",
                }),
                new cloudwatch.Metric({
                    label: "WCU",
                    namespace: "AWS/DynamoDB",
                    metricName: 'ConsumedWriteCapacityUnits',
                    dimensions: { TableName: dynTable.tableName },
                    statistic: "Sum",
                }),
            ],
        })));
    }
}
exports.LambdaMiddlewareRouterStack = LambdaMiddlewareRouterStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhX21pZGRsZXdhcmVfcm91dGVyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhX21pZGRsZXdhcmVfcm91dGVyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEscUNBQXFDO0FBQ3JDLDhDQUE4QztBQUM5QyxrREFBa0Q7QUFDbEQsc0RBQXNEO0FBRXRELDBDQUEyQztBQUMzQyxzREFBdUQ7QUFDdkQsd0NBQXlDO0FBQ3pDLHFFQUFzRTtBQUd0RSxNQUFhLDJCQUE0QixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hELFlBQVksS0FBb0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFFbEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsSUFBSSxRQUFRLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxFQUFFLEdBQUMsUUFBUSxFQUNuQztZQUNJLFNBQVMsRUFBRSxFQUFFLEdBQUMsUUFBUTtZQUN0QixZQUFZLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLElBQUk7Z0JBQ1YsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUNwQztZQUNELE9BQU8sRUFBRTtnQkFDUCxJQUFJLEVBQUUsSUFBSTtnQkFDVixJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1lBQ0QsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZQUNqRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQzNDLENBQUMsQ0FBQztRQUVuQixJQUFJLFdBQVcsR0FBRyxNQUFNLENBQUM7UUFDekIsSUFBSSxhQUFhLEdBQUcsRUFBRSxDQUFDO1FBQ3ZCLElBQUksU0FBUyxHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsRUFBRSxHQUFDLFNBQVMsRUFBRTtZQUN0QyxZQUFZLEVBQUcs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QkFBaUI7WUFDeEIsSUFBSSxFQUFFO2dCQUNGLElBQUksVUFBVSxDQUFDLE1BQU0sQ0FBQztvQkFDbEIsS0FBSyxFQUFFLEtBQUs7b0JBQ1osU0FBUyxFQUFFLGNBQWM7b0JBQ3pCLFVBQVUsRUFBQywyQkFBMkI7b0JBQ3RDLFVBQVUsRUFBRSxFQUFFLFNBQVMsRUFBRSxRQUFRLENBQUMsU0FBUyxFQUFFO29CQUM3QyxTQUFTLEVBQUUsS0FBSztpQkFDbkIsQ0FBQztnQkFDRixJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUM7b0JBQ2xCLEtBQUssRUFBRSxLQUFLO29CQUNaLFNBQVMsRUFBRSxjQUFjO29CQUN6QixVQUFVLEVBQUMsNEJBQTRCO29CQUN2QyxVQUFVLEVBQUUsRUFBRSxTQUFTLEVBQUUsUUFBUSxDQUFDLFNBQVMsRUFBRTtvQkFDN0MsU0FBUyxFQUFFLEtBQUs7aUJBQ25CLENBQUM7YUFDTDtTQUNKLENBQUMsQ0FDTCxDQUNGLENBQUM7SUFFSixDQUFDO0NBQ0Y7QUF4V0Qsa0VBd1dDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ0Bhd3MtY2RrL2NvcmUnO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ0Bhd3MtY2RrL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnQGF3cy1jZGsvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnQGF3cy1jZGsvYXdzLWFwaWdhdGV3YXknO1xuXG5pbXBvcnQgbG9ncyA9IHJlcXVpcmUoJ0Bhd3MtY2RrL2F3cy1sb2dzJyk7XG5pbXBvcnQgY2xvdWR3YXRjaCA9IHJlcXVpcmUoJ0Bhd3MtY2RrL2F3cy1jbG91ZHdhdGNoJyk7XG5pbXBvcnQgc25zID0gcmVxdWlyZSgnQGF3cy1jZGsvYXdzLXNucycpO1xuaW1wb3J0IGNsb3Vkd2F0Y2hhY3Rpb25zID0gcmVxdWlyZSgnQGF3cy1jZGsvYXdzLWNsb3Vkd2F0Y2gtYWN0aW9ucycpO1xuXG5cbmV4cG9ydCBjbGFzcyBMYW1iZGFNaWRkbGV3YXJlUm91dGVyU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogY2RrLkNvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcylcbiAge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgbGV0IGR5blRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIGlkK1wiLXRhYmxlXCIsXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhYmxlTmFtZTogaWQrXCItdGFibGVcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnUEsnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklOR1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ1NLJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICBsZXQgZW52aXJvbm1lbnQgPSBcInByb2RcIjtcbiAgICBsZXQgbGFtYmRhVGltZW91dCA9IDI1O1xuICAgIGxldCBhcGlMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGlkK1wiLWxhbWJkYVwiLCB7XG4gICAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb25OYW1lOiAgaWQrXCItbGFtYmRhXCIsXG4gICAgICAgICAgICAgICAgICAgICAgY29kZTogbmV3IGxhbWJkYS5Bc3NldENvZGUoJy4vc3JjL2xhbWJkYS9hcGkvJyksXG4gICAgICAgICAgICAgICAgICAgICAgaGFuZGxlcjogJ2FwcC5oYW5kbGVyJyxcbiAgICAgICAgICAgICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMTJfWCxcbiAgICAgICAgICAgICAgICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyhsYW1iZGFUaW1lb3V0KSxcbiAgICAgICAgICAgICAgICAgICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAxMCxcbiAgICAgICAgICAgICAgICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgVkVSU0lPTjogXCIxLjAuMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgQlVJTEQ6IFwiMVwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgVElNRU9VVDogXCJcIitsYW1iZGFUaW1lb3V0LFxuXG4gICAgICAgICAgICAgICAgICAgICAgICBFTkFCTEVfQ0hBT1M6IFwiZmFsc2VcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIElOSkVDVF9FUlJPUjogXCJ0cnVlXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBJTkpFQ1RfTEFURU5DWTogXCI1MDAwXCIsXG5cbiAgICAgICAgICAgICAgICAgICAgICAgIERZTkFNT19UQUJMRTogZHluVGFibGUudGFibGVOYW1lXG4gICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkVcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgZHluVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUxhbWJkYSk7XG5cbiAgICBsZXQgYXBpTmFtZSA9IGlkO1xuICAgIGxldCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsIGlkK1wiLWFwaVwiLCB7XG4gICAgICAgICAgICAgICAgICByZXN0QXBpTmFtZTogaWQsXG4gICAgICAgICAgICAgICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgICAgICAgc3RhZ2VOYW1lOiBlbnZpcm9ubWVudCxcbiAgICAgICAgICAgICAgICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgIHRyYWNpbmdFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuT0ZGXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgICAgICAgICAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgICAgICAgICAgICAgICAgYWxsb3dIZWFkZXJzOiBbXCIqXCJdXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgYXBpLnJvb3QuYWRkUHJveHkoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0SW50ZWdyYXRpb246IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGFwaUxhbWJkYSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGFueU1ldGhvZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RZTkFNT19UQUJMRScsIHsgdmFsdWU6IGR5blRhYmxlLnRhYmxlTmFtZSB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQVBJX1VSTCcsIHsgdmFsdWU6IGFwaS51cmwgfSlcblxuICAgIC8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAgICA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSBMb2dnaW5nLCBBbGFybXMgJiBEYXNoYm9hcmQgPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgICAgPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xuXG4gICAgY29uc3QgYWxhcm1Ub3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgaWQrXCJhbGFybS10b3BpY1wiLCB7XG4gICAgICB0b3BpY05hbWU6IGlkK1wiYWxhcm0tdG9waWNcIixcbiAgICAgIGRpc3BsYXlOYW1lOiBpZCtcImFsYXJtLXRvcGljXCIsXG4gICAgfSk7XG4gICAgY29uc3QgY3dBbGFybUFjdGlvbiA9IG5ldyBjbG91ZHdhdGNoYWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYyk7XG5cblxuICAgIGZ1bmN0aW9uIE1ldHJpY1RvQWxhcm1OYW1lKG1ldHJpYzogY2xvdWR3YXRjaC5NZXRyaWMpXG4gICAge1xuICAgICAgbGV0IGRpbTFWYWwgPSBudWxsO1xuICAgICAgaWYobWV0cmljLnRvQWxhcm1Db25maWcoKS5kaW1lbnNpb25zKVxuICAgICAge1xuICAgICAgICAgIGxldCBkaW1lbnNpb25zID0gbWV0cmljLnRvQWxhcm1Db25maWcoKS5kaW1lbnNpb25zID8gbWV0cmljLnRvQWxhcm1Db25maWcoKS5kaW1lbnNpb25zIGFzIGNsb3Vkd2F0Y2guRGltZW5zaW9uW10gOiBbXTtcbiAgICAgICAgICBpZihkaW1lbnNpb25zLmxlbmd0aCA+IDApXG4gICAgICAgICAgICAgIGRpbTFWYWwgPSBkaW1lbnNpb25zWzBdLnZhbHVlO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gaWQgKyBcIjo6XCIgKyBbbWV0cmljLm5hbWVzcGFjZSwgbWV0cmljLm1ldHJpY05hbWUsIGRpbTFWYWxdLmpvaW4oJy8nKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gU29mdEVycm9yTGFtYmRhTWV0cmljRmlsdGVyQWxhcm0oc2NvcGU6IGNkay5Db25zdHJ1Y3QsIG1ldHJpY05hbWU6IHN0cmluZywgZmlsdGVyUGF0dGVybjogbG9ncy5JRmlsdGVyUGF0dGVybixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFtYmRhRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbiwgY3dBbGFybUFjdGlvbjogY2xvdWR3YXRjaC5JQWxhcm1BY3Rpb24pXG4gICAge1xuICAgICAgY29uc3QgTUVUUklDX05BTUVTUEFDRSA9ICdMb2dNZXRyaWNzL0xhbWJkYSc7XG5cbiAgICAgIGxldCBzYWZlQ29uc3RydWN0SWQgPSBsYW1iZGFGdW5jdGlvbi5ub2RlLmlkICsgXCItXCIgKyBtZXRyaWNOYW1lLnJlcGxhY2UoL1xcLy9nbSwgJy0nKTtcblxuXG4gICAgICAvKiBMb2dNZXRyaWNGaWx0ZXJzIGRvIG5vdCB0YWtlIGludG8gYWNjb3VudCBEaW1lbnNpb24sIHNvIGNyZWF0aW5nIGEgbmFtZXNwYWNlIHdpdGggbWV0cmljbmFtZSAqL1xuICAgICAgY29uc3QgbWV0cmljID0gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICBuYW1lc3BhY2U6IE1FVFJJQ19OQU1FU1BBQ0UgKyBcIi9cIiArIG1ldHJpY05hbWUsXG4gICAgICAgICAgbWV0cmljTmFtZTogbGFtYmRhRnVuY3Rpb24ubm9kZS5pZCxcbiAgICAgIH0pO1xuICAgICAgLy9AdHMtaWdub3JlXG4gICAgICBsZXQgZmlsdGVyID0gbmV3IGxvZ3MuTWV0cmljRmlsdGVyKHNjb3BlLCBzYWZlQ29uc3RydWN0SWQrJ0ZpbHRlcicsIHtcbiAgICAgICAgICBtZXRyaWNOYW1lOiBtZXRyaWMubWV0cmljTmFtZSxcbiAgICAgICAgICBtZXRyaWNOYW1lc3BhY2U6IG1ldHJpYy5uYW1lc3BhY2UsXG4gICAgICAgICAgbG9nR3JvdXA6IGxhbWJkYUZ1bmN0aW9uLmxvZ0dyb3VwLFxuICAgICAgICAgIGZpbHRlclBhdHRlcm46IGZpbHRlclBhdHRlcm4sXG4gICAgICAgICAgbWV0cmljVmFsdWU6IFwiMVwiXG4gICAgICB9KTtcbiAgICAgIGxldCBhbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHNjb3BlLCBzYWZlQ29uc3RydWN0SWQrJ0FsYXJtJywge1xuICAgICAgICAgIG1ldHJpYzogbWV0cmljLFxuICAgICAgICAgIGFjdGlvbnNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGFsYXJtTmFtZTogTWV0cmljVG9BbGFybU5hbWUobWV0cmljKSxcbiAgICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICAgICAgc3RhdGlzdGljOiBcIlN1bVwiLFxuICAgICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgICB9KTtcbiAgICAgIGFsYXJtLmFkZEFsYXJtQWN0aW9uKGN3QWxhcm1BY3Rpb24pO1xuICAgICAgYWxhcm0uYWRkT2tBY3Rpb24oY3dBbGFybUFjdGlvbik7XG5cbiAgICAgIHJldHVybiBhbGFybTsgLy9bbWV0cmljLCBmaWx0ZXIsIGFsYXJtXVxuICAgIH1cblxuICAgIGxldCBhcGlMYW1iZGFBbGFybV9IYW5kbGVkRXJyb3IgPSBTb2Z0RXJyb3JMYW1iZGFNZXRyaWNGaWx0ZXJBbGFybSh0aGlzLCAnRXJyb3JzL0hhbmRsZWRFcnJvcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvZ3MuRmlsdGVyUGF0dGVybi5hbGwoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uc3RyaW5nVmFsdWUoXCIkLmxldmVsXCIsIFwiPVwiLCBcImF1ZGl0XCIpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbG9ncy5GaWx0ZXJQYXR0ZXJuLmJvb2xlYW5WYWx1ZShcIiQuYXJncy5zdGF0dXNcIiwgIGZhbHNlKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvZ3MuRmlsdGVyUGF0dGVybi5ib29sZWFuVmFsdWUoXCIkLmFyZ3MucmFpc2VfYWxhcm1cIiwgIHRydWUpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbG9ncy5GaWx0ZXJQYXR0ZXJuLnN0cmluZ1ZhbHVlKFwiJC5hcmdzLnN0YXR1c19jb2RlXCIsIFwiPVwiLCBcIjUwMDFcIikpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlMYW1iZGEsIGN3QWxhcm1BY3Rpb24pO1xuICAgIGxldCBhcGlMYW1iZGFBbGFybV9WYWxpZGF0aW9uRXJyb3IgPSBTb2Z0RXJyb3JMYW1iZGFNZXRyaWNGaWx0ZXJBbGFybSh0aGlzLCAnRXJyb3JzL1ZhbGlkYXRpb25FcnJvcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uYWxsKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvZ3MuRmlsdGVyUGF0dGVybi5zdHJpbmdWYWx1ZShcIiQubGV2ZWxcIiwgXCI9XCIsIFwiYXVkaXRcIiksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbG9ncy5GaWx0ZXJQYXR0ZXJuLmJvb2xlYW5WYWx1ZShcIiQuYXJncy5zdGF0dXNcIiwgIGZhbHNlKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uYm9vbGVhblZhbHVlKFwiJC5hcmdzLnJhaXNlX2FsYXJtXCIsICB0cnVlKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uc3RyaW5nVmFsdWUoXCIkLmFyZ3Muc3RhdHVzX2NvZGVcIiwgXCI9XCIsIFwiNTAwMlwiKSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlMYW1iZGEsIGN3QWxhcm1BY3Rpb24pO1xuICAgIGxldCAgYXBpTGFtYmRhQWxhcm1fQXV0aEVycm9yID0gU29mdEVycm9yTGFtYmRhTWV0cmljRmlsdGVyQWxhcm0odGhpcywgJ0Vycm9ycy9BdXRoRXJyb3InLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uYWxsKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbG9ncy5GaWx0ZXJQYXR0ZXJuLnN0cmluZ1ZhbHVlKFwiJC5sZXZlbFwiLCBcIj1cIiwgXCJhdWRpdFwiKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvZ3MuRmlsdGVyUGF0dGVybi5ib29sZWFuVmFsdWUoXCIkLmFyZ3Muc3RhdHVzXCIsICBmYWxzZSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uYm9vbGVhblZhbHVlKFwiJC5hcmdzLnJhaXNlX2FsYXJtXCIsICB0cnVlKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvZ3MuRmlsdGVyUGF0dGVybi5zdHJpbmdWYWx1ZShcIiQuYXJncy5zdGF0dXNfY29kZVwiLCBcIj1cIiwgXCIzMDAxXCIpKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpTGFtYmRhLCBjd0FsYXJtQWN0aW9uKTtcbiAgICBsZXQgIGFwaUxhbWJkYUFsYXJtX1VuZXhwZWN0ZWRFcnJvciA9IFNvZnRFcnJvckxhbWJkYU1ldHJpY0ZpbHRlckFsYXJtKHRoaXMsICdFcnJvcnMvVW5leHBlY3RlZEVycm9yJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uYWxsKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uc3RyaW5nVmFsdWUoXCIkLmxldmVsXCIsIFwiPVwiLCBcImF1ZGl0XCIpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uYm9vbGVhblZhbHVlKFwiJC5hcmdzLnN0YXR1c1wiLCAgZmFsc2UpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsb2dzLkZpbHRlclBhdHRlcm4uYm9vbGVhblZhbHVlKFwiJC5hcmdzLnJhaXNlX2FsYXJtXCIsICB0cnVlKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbG9ncy5GaWx0ZXJQYXR0ZXJuLnN0cmluZ1ZhbHVlKFwiJC5hcmdzLnN0YXR1c19jb2RlXCIsIFwiPVwiLCBcIjUwMDBcIikpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaUxhbWJkYSwgY3dBbGFybUFjdGlvbik7XG5cblxuICAgIGxldCBhcGlMYW1iZGFBbGFybUhhcmRFcnJvciA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsIGlkK1wiQXBpSGFyZEVycm9yQWxhcm1cIiwge1xuICAgICAgbWV0cmljOiBhcGlMYW1iZGEubWV0cmljRXJyb3JzKCksXG4gICAgICBhY3Rpb25zRW5hYmxlZDogdHJ1ZSxcbiAgICAgIGFsYXJtTmFtZTogTWV0cmljVG9BbGFybU5hbWUoYXBpTGFtYmRhLm1ldHJpY0Vycm9ycygpKSxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX09SX0VRVUFMX1RPX1RIUkVTSE9MRCxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHN0YXRpc3RpYzogXCJTdW1cIixcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgYXBpTGFtYmRhQWxhcm1IYXJkRXJyb3IuYWRkQWxhcm1BY3Rpb24oY3dBbGFybUFjdGlvbik7XG4gICAgYXBpTGFtYmRhQWxhcm1IYXJkRXJyb3IuYWRkT2tBY3Rpb24oY3dBbGFybUFjdGlvbik7XG5cbiAgICBsZXQgYXBpTWV0cmljQ291bnQgPSAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgIG5hbWVzcGFjZTogXCJBV1MvQXBpR2F0ZXdheVwiLFxuICAgICAgbWV0cmljTmFtZTonQ291bnQnLFxuICAgICAgZGltZW5zaW9uczogeyBBcGlOYW1lOiBhcGlOYW1lIH1cbiAgICB9KTtcbiAgICBsZXQgYXBpQWxhcm1IaWdoVXNhZ2UgPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLGlkK1wiQXBpR2F0ZXdheUhlYXZ5VXNhZ2VcIiwge1xuICAgICAgbWV0cmljOiBhcGlNZXRyaWNDb3VudCxcbiAgICAgIGFjdGlvbnNFbmFibGVkOiB0cnVlLFxuICAgICAgYWxhcm1OYW1lOiBNZXRyaWNUb0FsYXJtTmFtZShhcGlNZXRyaWNDb3VudCksXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICB0aHJlc2hvbGQ6IDEwMCxcbiAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMyxcbiAgICAgIHN0YXRpc3RpYzogXCJTdW1cIixcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgYXBpQWxhcm1IaWdoVXNhZ2UuYWRkQWxhcm1BY3Rpb24oY3dBbGFybUFjdGlvbik7XG4gICAgYXBpQWxhcm1IaWdoVXNhZ2UuYWRkT2tBY3Rpb24oY3dBbGFybUFjdGlvbik7XG5cblxuXG5cblxuXG4gICAgbGV0IGRhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCBpZCsnLWRhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6IGlkLFxuICAgICAgc3RhcnQ6IFwiLVBUMjRIXCIsXG4gICAgICBwZXJpb2RPdmVycmlkZTogY2xvdWR3YXRjaC5QZXJpb2RPdmVycmlkZS5BVVRPXG4gICAgfSk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgIG1hcmtkb3duOiAnIyBMYW1iZGEgTWV0cmljcycsXG4gICAgICB3aWR0aDogMjRcbiAgICB9KSk7XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5Sb3coXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgICB0aXRsZTogXCJMYW1iZGEgSGFyZCBFcnJvcnNcIiwgbGVmdDogW1xuICAgICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ2FwaScsXG4gICAgICAgICAgICAgICAgICAgICAgbmFtZXNwYWNlOiBcIkFXUy9MYW1iZGFcIixcbiAgICAgICAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOidFcnJvcnMnLFxuICAgICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnM6IHsgRnVuY3Rpb25OYW1lOiBhcGlMYW1iZGEuZnVuY3Rpb25OYW1lIH0sXG4gICAgICAgICAgICAgICAgICAgICAgc3RhdGlzdGljOiBcIlN1bVwiLFxuICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIF19KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICAgIHRpdGxlOiBcIkxhbWJkYSBJbnZvY2F0aW9uc1wiLFxuICAgICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnYXBpIC0gSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogXCJBV1MvTGFtYmRhXCIsXG4gICAgICAgICAgICAgICAgICAgICAgbWV0cmljTmFtZTonSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnM6IHsgRnVuY3Rpb25OYW1lOiBhcGlMYW1iZGEuZnVuY3Rpb25OYW1lIH0sXG4gICAgICAgICAgICAgICAgICAgICAgc3RhdGlzdGljOiBcIlN1bVwiLFxuICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnYXBpIC0gQ29uY3VycmVudEV4ZWN1dGlvbnMnLFxuICAgICAgICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogXCJBV1MvTGFtYmRhXCIsXG4gICAgICAgICAgICAgICAgICAgICAgbWV0cmljTmFtZTonQ29uY3VycmVudEV4ZWN1dGlvbnMnLFxuICAgICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnM6IHsgRnVuY3Rpb25OYW1lOiBhcGlMYW1iZGEuZnVuY3Rpb25OYW1lIH0sXG4gICAgICAgICAgICAgICAgICAgICAgc3RhdGlzdGljOiBcIk1heGltdW1cIixcbiAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgICAgdGl0bGU6IFwiTGFtYmRhIER1cmF0aW9uXCIsXG4gICAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6IFwiYXBpIC0gcDk1XCIsXG4gICAgICAgICAgICAgICAgICAgICAgbmFtZXNwYWNlOiBcIkFXUy9MYW1iZGFcIixcbiAgICAgICAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOidEdXJhdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgZGltZW5zaW9uczogeyBGdW5jdGlvbk5hbWU6IGFwaUxhbWJkYS5mdW5jdGlvbk5hbWUgfSxcbiAgICAgICAgICAgICAgICAgICAgICBzdGF0aXN0aWM6IFwicDk1XCJcbiAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogXCJhcGkgLSBhdmdcIixcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0xhbWJkYVwiLFxuICAgICAgICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6J0R1cmF0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICBkaW1lbnNpb25zOiB7IEZ1bmN0aW9uTmFtZTogYXBpTGFtYmRhLmZ1bmN0aW9uTmFtZSB9LFxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogXCJBdmVyYWdlXCJcbiAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogXCJhcGkgLSBtYXhcIixcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0xhbWJkYVwiLFxuICAgICAgICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6J0R1cmF0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICBkaW1lbnNpb25zOiB7IEZ1bmN0aW9uTmFtZTogYXBpTGFtYmRhLmZ1bmN0aW9uTmFtZSB9LFxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogXCJNYXhpbXVtXCJcbiAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgICAgdGl0bGU6IFwiQVBJIExhbWJkYSBTb2Z0IEVycm9yc1wiLFxuICAgICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgICAgICBhcGlMYW1iZGFBbGFybV9IYW5kbGVkRXJyb3IubWV0cmljLFxuICAgICAgICAgICAgICAgICAgYXBpTGFtYmRhQWxhcm1fVmFsaWRhdGlvbkVycm9yLm1ldHJpYyxcbiAgICAgICAgICAgICAgICAgIGFwaUxhbWJkYUFsYXJtX0F1dGhFcnJvci5tZXRyaWMsXG4gICAgICAgICAgICAgICAgICBhcGlMYW1iZGFBbGFybV9VbmV4cGVjdGVkRXJyb3IubWV0cmljLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgKVxuICAgICk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgIG1hcmtkb3duOiAnIyBBUEkgTWV0cmljcycsXG4gICAgICB3aWR0aDogMjRcbiAgICB9KSk7XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5Sb3coXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm1XaWRnZXQoe3RpdGxlOiBcIkFQSSBIaWdoIFVzYWdlXCIsIGFsYXJtOiBhcGlBbGFybUhpZ2hVc2FnZX0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgICAgdGl0bGU6IFwiQVBJIER1cmF0aW9uXCIsXG4gICAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZXNwYWNlOiBcIkFXUy9BcGlHYXRld2F5XCIsXG4gICAgICAgICAgICAgICAgICAgICAgbWV0cmljTmFtZTonTGF0ZW5jeScsXG4gICAgICAgICAgICAgICAgICAgICAgZGltZW5zaW9uczogIHsgQXBpTmFtZTogYXBpTmFtZSB9LFxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogXCJwOTVcIixcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogXCJwOTVcIlxuICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogXCJBV1MvQXBpR2F0ZXdheVwiLFxuICAgICAgICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6J0xhdGVuY3knLFxuICAgICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnM6ICB7IEFwaU5hbWU6IGFwaU5hbWUgfSxcbiAgICAgICAgICAgICAgICAgICAgICBzdGF0aXN0aWM6IFwiQXZlcmFnZVwiLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiBcIkF2ZXJhZ2VcIlxuICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogXCJBV1MvQXBpR2F0ZXdheVwiLFxuICAgICAgICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6J0xhdGVuY3knLFxuICAgICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnM6ICB7IEFwaU5hbWU6IGFwaU5hbWUgfSxcbiAgICAgICAgICAgICAgICAgICAgICBzdGF0aXN0aWM6IFwiTWF4aW11bVwiLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiBcIk1heGltdW1cIlxuICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgICB0aXRsZTogXCJBUEkgSFRUUCBFcnJvcnNcIixcbiAgICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0FwaUdhdGV3YXlcIixcbiAgICAgICAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOic1WFhFcnJvcicsXG4gICAgICAgICAgICAgICAgICAgICAgZGltZW5zaW9uczogIHsgQXBpTmFtZTogYXBpTmFtZSB9LFxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogXCJTdW1cIixcbiAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0FwaUdhdGV3YXlcIixcbiAgICAgICAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOic0WFhFcnJvcicsXG4gICAgICAgICAgICAgICAgICAgICAgZGltZW5zaW9uczogIHsgQXBpTmFtZTogYXBpTmFtZSB9LFxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogXCJTdW1cIixcbiAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgKVxuICAgICk7XG5cblxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKG5ldyBjbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgbWFya2Rvd246ICcjIER5bmFtbycsXG4gICAgICB3aWR0aDogMjRcbiAgICB9KSk7XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5Sb3coXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgICB0aXRsZTogXCJEeW5hbW8gQ2FwYWNpdHlcIixcbiAgICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogXCJSQ1VcIixcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0R5bmFtb0RCXCIsXG4gICAgICAgICAgICAgICAgICAgICAgbWV0cmljTmFtZTonQ29uc3VtZWRSZWFkQ2FwYWNpdHlVbml0cycsXG4gICAgICAgICAgICAgICAgICAgICAgZGltZW5zaW9uczogeyBUYWJsZU5hbWU6IGR5blRhYmxlLnRhYmxlTmFtZSB9LFxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogXCJTdW1cIixcbiAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogXCJXQ1VcIixcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0R5bmFtb0RCXCIsXG4gICAgICAgICAgICAgICAgICAgICAgbWV0cmljTmFtZTonQ29uc3VtZWRXcml0ZUNhcGFjaXR5VW5pdHMnLFxuICAgICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnM6IHsgVGFibGVOYW1lOiBkeW5UYWJsZS50YWJsZU5hbWUgfSxcbiAgICAgICAgICAgICAgICAgICAgICBzdGF0aXN0aWM6IFwiU3VtXCIsXG4gICAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSxcbiAgICAgIClcbiAgICApO1xuXG4gIH1cbn1cbiJdfQ==