#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { LambdaMiddlewareRouterStack } from '../lib/lambda_middleware_router-stack';

const app = new cdk.App();
new LambdaMiddlewareRouterStack(app, 'LambdaMiddlewareRouter');
