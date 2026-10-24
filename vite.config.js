import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const sendJson = (response, status, payload) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
};

const readJsonBody = (request) => new Promise((resolve, reject) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 30_000_000) {
      reject(new Error('Audio upload is too large. Record a shorter segment.'));
      request.destroy();
    }
  });
  request.on('end', () => {
    try {
      resolve(JSON.parse(body));
    } catch {
      reject(new Error('Invalid transcription request.'));
    }
  });
  request.on('error', reject);
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      {
        name: 'bhashini-transcription-api',
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url?.split('?')[0] !== '/api/bhashini/transcribe') return next();
            if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed.' });

            const missingSettings = ['BHASHINI_USER_ID', 'BHASHINI_ULCA_API_KEY', 'BHASHINI_PIPELINE_ID']
              .filter((key) => !env[key]);
            if (missingSettings.length) {
              return sendJson(response, 503, {
                error: `Configure ${missingSettings.join(', ')} in .env.local to enable Bhashini.`,
              });
            }

            try {
              const { audioContent, sourceLanguage = 'hi', audioFormat = 'wav', samplingRate = 16000 } = await readJsonBody(request);
              if (typeof audioContent !== 'string' || !audioContent) {
                return sendJson(response, 400, { error: 'Recorded audio is required.' });
              }

              const configResponse = await fetch('https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  userID: env.BHASHINI_USER_ID,
                  ulcaApiKey: env.BHASHINI_ULCA_API_KEY,
                },
                body: JSON.stringify({
                  pipelineTasks: [{ taskType: 'asr', config: { language: { sourceLanguage } } }],
                  pipelineRequestConfig: { pipelineId: env.BHASHINI_PIPELINE_ID },
                }),
              });
              if (!configResponse.ok) {
                return sendJson(response, 502, { error: `Bhashini pipeline config failed (${configResponse.status}).` });
              }

              const pipelineConfig = await configResponse.json();
              const asrConfig = pipelineConfig.pipelineResponseConfig
                ?.find((task) => task.taskType === 'asr')
                ?.config
                ?.find((config) => config.language?.sourceLanguage === sourceLanguage);
              const endpoint = pipelineConfig.pipelineInferenceAPIEndPoint;
              const callbackUrl = endpoint?.callbackUrl;
              const inferenceKey = endpoint?.inferenceApiKey;
              if (!asrConfig?.serviceId || !callbackUrl || !inferenceKey?.name || !inferenceKey?.value) {
                return sendJson(response, 502, { error: 'Bhashini returned incomplete Hindi ASR configuration.' });
              }

              const callback = new URL(callbackUrl);
              if (callback.protocol !== 'https:' || !callback.hostname.endsWith('.bhashini.gov.in')) {
                return sendJson(response, 502, { error: 'Bhashini returned an untrusted inference endpoint.' });
              }

              const inferenceResponse = await fetch(callback, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  [inferenceKey.name]: inferenceKey.value,
                },
                body: JSON.stringify({
                  pipelineTasks: [{
                    taskType: 'asr',
                    config: {
                      language: { sourceLanguage },
                      serviceId: asrConfig.serviceId,
                      audioFormat,
                      samplingRate,
                    },
                  }],
                  inputData: {
                    input: [{ source: null }],
                    audio: [{ audioContent }],
                  },
                }),
              });
              if (!inferenceResponse.ok) {
                return sendJson(response, 502, { error: `Bhashini transcription failed (${inferenceResponse.status}).` });
              }

              const inference = await inferenceResponse.json();
              const transcript = inference.pipelineResponse
                ?.find((task) => task.taskType === 'asr')
                ?.output?.[0]?.source;
              if (!transcript) return sendJson(response, 502, { error: 'Bhashini returned no transcript.' });
              return sendJson(response, 200, { transcript });
            } catch (error) {
              const status = error.message?.includes('Audio upload is too large') ? 413 : 500;
              return sendJson(response, status, { error: error.message || 'Bhashini transcription failed.' });
            }
          });
        },
      },
    ],
  };
});