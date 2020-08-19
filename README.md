# Lambda Middleware Router

This is a stock standard CDK project using TypeScript for the CDK and JS for the Lambda function.

### Prerequisites:
1. All of the prerequisites for AWS CLI and CDK have been done: https://cdkworkshop.com/15-prerequisites.html
2. Search and replace `rehan-demo` with your AWS profile name
3. AWS CDK bootstrap must have been run in the account already.

### Up and running
 * Run `npm install`
 * Change directory to ***/test*** and run `npm install` (optinal: only if you want to run tests)

### Useful commands
 * `cdk diff`                   compare deployed stack with current state
 * `cdk deploy`                 deploy this stack to your default AWS account/region
 * `artillery-ping-pong`        does light load testing using `artillery` 
 * `artillery-create-person`    does light load testing using `artillery` and creates many persons

## Testing 

Integration/end-to-end (e2e) and a basic load tests is written. Testing each api path and parameter combinations in certain tests. 
Both negative and positive tests are written. All code/src tests are in `/test`.

Unit tests for the helper and middleware classes have been omitted for now.

### End-2-End

- Change the URL and other constants if needed in `/test/_helpers/lambda_app.js` at the bottom of the file.

##### Local testing
- This requires at least 1 deployment, we run the code local but it still needs to use the AWS resources like DynamoDB to store the data.
- Make sure that ``helper.TestAgainst = Helper.TEST_AGAINST__DEPLOYED;``  **IS** commented out. Note that this can also be passed as command line argument for CI/CD considerations.
- Then test the /v1/ping/pong method. Other tests can also be done in a similar fashion.
    ```
    node .\test\node_modules\mocha\bin\_mocha --ui bdd  .\test\e2e\lambda\api\test-ping.js --grep "^Test Ping Pong Returns Pong$"
    ```
  
##### Against deployed
- Make sure that ``helper.TestAgainst = Helper.TEST_AGAINST__DEPLOYED;``  **IS NOT** commented out. Note that this can also be passed as command line argument for CI/CD considerations.
- Then test the /v1/ping/pong method. Other tests can also be done in a similar fashion.
    ```
    node .\test\node_modules\mocha\bin\_mocha --ui bdd  .\test\e2e\lambda\api\test-ping.js --grep "^Test Ping Pong Returns Pong$"
    ```
  
### Load test
- Make sure you have `artillery` installed globally
- The lambda function concurrency is set to 10.

```
npm install -g artillery
```
- Change the URL in the file `/test/load/ping-pong.yml`
- Run the command using npm 
```
npm run artillery-ping-pong
```

## General

The project consists of AWS API Gateway, AWS Lambda NodeJS functions written in JS and DynamoDB as the datastore. The AWS 
CDK is used as the IaC tool to generate the CloudFormation and then execute. We are using a monorepo and lambdalith, the 
entry point for the API is at `src\lambda\api\app.js`

This repo contains 2 endpoints with 3 API calls. A `GET /ping` call to make sure the API is working and then `POST /person`
to create a person and `GET /person` to retrieve the first X amount of people. More info can be found in the API Swagger 
file can be found at `/src/lambda/api/api-definition.yaml`.

The business logic is within the `/v1` directory. The middleware implements the helper classes, this is important as they
can be tested individually, similarly the business logic can be tested without the router. 
Both the business logic and helper classes are loosely coupled to router and middleware respectively, both these components can be moved to an MVC architecture with ease.

This project contains dashboards and alerts for the Lambda function, DynamoDB and API Gateway. 
You can read more about what is included here: https://www.rehanvdm.com/general/aws-serverless-you-might-not-need-third-party-monitoring/index.html