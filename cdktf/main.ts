import { App } from 'cdktf';
import { CdktfStack } from './stack/cdktf-stack';

const app = new App();

new CdktfStack(app, 'CdktfStack');

app.synth();
