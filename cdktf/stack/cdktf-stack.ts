import { CodebuildProject } from '@cdktf/provider-aws/lib/codebuild-project';
import { Codepipeline } from '@cdktf/provider-aws/lib/codepipeline';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { TerraformStack } from 'cdktf';
import { Construct } from 'constructs';

export class CdktfStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Artifact Bucket
    const artifactBucket = new S3Bucket(scope, 'ArtifactBucket');

    const artifactAccessPolicy = new IamPolicy(scope, 'ArtifactAccessPolicy', {
      name: 'ArtifactAccessPolicy',
      policy: new DataAwsIamPolicyDocument(scope, 'ArtifactPolicy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['s3:GetObject', 's3:GetObjectVersion', 's3:GetBucketVersioning', 's3:PutObjectAcl', 's3:PutObject'],
            resources: [artifactBucket.bucket, `${artifactBucket.bucket}/*`],
          },
        ],
      }).json,
    });

    // Source
    const sourceBucket = new S3Bucket(scope, 'SourceBucket');

    const sourceBucketAccessPolicy = new IamPolicy(scope, 'SourceBucketAccessPolicy', {
      name: 'SourceBucketAccessPolicy',
      policy: new DataAwsIamPolicyDocument(scope, 'SourceBucketPolicy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['s3:*'],
            resources: [sourceBucket.bucket, `${sourceBucket.bucket}/*`],
          },
        ],
      }).json,
    });

    // Build
    const buildPolicy = new DataAwsIamPolicyDocument(scope, 'BuildPolicy', {
      statement: [
        {
          effect: 'Allow',
          actions: ['sts:AssumeRole'],
          principals: [{ type: 'Service', identifiers: ['codebuild.amazonaws.com'] }],
        },
      ],
    });

    const buildRole = new IamRole(scope, 'BuildRole', {
      name: 'buildRole',
      assumeRolePolicy: buildPolicy.json,
      managedPolicyArns: [artifactAccessPolicy.arn],
    });

    const buildProject = new CodebuildProject(scope, 'BuildProject', {
      name: 'BuildProject',
      serviceRole: buildRole.arn,
      source: {
        type: 'CODEPIPELINE',
        buildspec: 'buildspec.yml',
      },
      artifacts: {
        type: 'CODEPIPELINE',
      },
      environment: {
        computeType: 'BUILD_GENERAL1_SMALL',
        image: 'aws/codebuild/standard:7.0',
        type: 'LINUX_CONTAINER',
      },
    });

    // Pipeline
    const buildExecutionPolicy = new DataAwsIamPolicyDocument(scope, 'buildExecutionPolicy', {
      statement: [
        {
          effect: 'Allow',
          actions: ['codebuild:BatchGetBuilds', 'codebuild:StartBuild'],
          resources: [buildProject.arn],
        },
      ],
    });

    const pipelineRole = new IamRole(scope, 'CodePipelineRole', {
      name: 'CodePipelineRole',
      assumeRolePolicy: new DataAwsIamPolicyDocument(scope, 'PipelineAssumeRolePolicy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['codepipeline.amazonaws.com'] }],
          },
        ],
      }).json,
      managedPolicyArns: [artifactAccessPolicy.arn, sourceBucketAccessPolicy.arn],
      inlinePolicy: [
        {
          name: 'PipelineBuildExecutionPolicy',
          policy: buildExecutionPolicy.json,
        },
      ],
    });

    new Codepipeline(scope, `${id}-CodePipeline`, {
      name: 'cdktf-pipeline',
      roleArn: pipelineRole.arn,
      artifactStore: [{ location: artifactBucket.bucket, type: 'S3' }],
      stage: [
        {
          name: 'Source',
          action: [
            {
              name: 'S3_Source',
              category: 'Source',
              owner: 'AWS',
              provider: 'S3',
              version: '1',
              outputArtifacts: ['source_output'],
              configuration: {
                S3Bucket: sourceBucket.bucket,
                S3ObjectKey: 'path/to/file.zip',
              },
            },
          ],
        },
        {
          name: 'Build',
          action: [
            {
              name: 'Build',
              category: 'Build',
              owner: 'AWS',
              provider: 'CodeBuild',
              inputArtifacts: ['source_output'],
              version: '1',
              configuration: {
                ProjectName: buildProject.name,
              },
            },
          ],
        },
      ],
    });
  }
}
