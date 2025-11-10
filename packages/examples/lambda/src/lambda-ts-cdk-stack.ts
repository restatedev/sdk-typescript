/*
 * Copyright (c) 2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate examples,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in the file LICENSE
 * in the root directory of this repository or package or at
 * https://github.com/restatedev/examples/
 */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambda_nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";

export class LambdaTsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // Lambda execution role (for running the Lambda)
    const executionRole = new iam.Role(this, "GreeterExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });

    const greeterFunction = new lambda_nodejs.NodejsFunction(this, "Greeter", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../../lambda/lib/lambda/handler.ts"),
      handler: "handler",
      role: executionRole,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["aws-sdk"], // Don't bundle AWS SDK
      },
    });

    const version = greeterFunction.currentVersion;

    // Separate invoker role (for Restate to assume and invoke Lambda)
    const invokerRole = new iam.Role(this, "RestateInvokerRole", {
      assumedBy: new iam.AccountPrincipal(this.account),
      description: "Role for Restate to invoke Lambda functions",
    });

    // Grant the invoker role permission to invoke the Lambda
    greeterFunction.grantInvoke(invokerRole);
    version.grantInvoke(invokerRole);

    // Output the invoker role ARN (for Restate to assume)
    new cdk.CfnOutput(this, "InvokerRoleArn", {
      value: invokerRole.roleArn,
      description: "Role ARN for invoking Lambda (for Restate)",
      exportName: `${this.stackName}-InvokerRoleArn`,
    });

    // Output the function ARN
    new cdk.CfnOutput(this, "FunctionVersionArn", {
      value: version.functionArn,
      description: "Lambda Function Version ARN (qualified)",
      exportName: `${this.stackName}-FunctionVersionArn`,
    });
  }
}
