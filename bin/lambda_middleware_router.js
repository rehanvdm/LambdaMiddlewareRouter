#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = require("@aws-cdk/core");
const lambda_middleware_router_stack_1 = require("../lib/lambda_middleware_router-stack");
const app = new cdk.App();
new lambda_middleware_router_stack_1.LambdaMiddlewareRouterStack(app, 'LambdaMiddlewareRouter');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhX21pZGRsZXdhcmVfcm91dGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhX21pZGRsZXdhcmVfcm91dGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVDQUFxQztBQUNyQyxxQ0FBcUM7QUFDckMsMEZBQW9GO0FBRXBGLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQzFCLElBQUksNERBQTJCLENBQUMsR0FBRyxFQUFFLHdCQUF3QixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3Rlcic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnQGF3cy1jZGsvY29yZSc7XG5pbXBvcnQgeyBMYW1iZGFNaWRkbGV3YXJlUm91dGVyU3RhY2sgfSBmcm9tICcuLi9saWIvbGFtYmRhX21pZGRsZXdhcmVfcm91dGVyLXN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcbm5ldyBMYW1iZGFNaWRkbGV3YXJlUm91dGVyU3RhY2soYXBwLCAnTGFtYmRhTWlkZGxld2FyZVJvdXRlcicpO1xuIl19