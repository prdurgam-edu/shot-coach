# Shot Coach

A web app that coaches the person holding the phone (and the people being photographed), then takes the shot.
Prompts are spoken and shown in English, Hindi and Telugu.

Faces are found in one of two ways, chosen in Settings:

- **On my server (default).** The phone sends a small picture about once a second to a server you run on Google Cloud. Gemini finds the faces, flags closed eyes and smiles, and the app coaches from the answer. Nothing is stored.
- **On this phone.** Detection runs on the phone itself with MediaPipe. It needs no server but depends on the phone and browser.

## 1. Put the app online

The app is a static site. GitHub Pages serves it at https://prdurgam-edu.github.io/shot-coach/ (Settings > Pages > Deploy from branch `main`, folder `/ (root)`). Camera access needs https, so do not open `index.html` from a file.

## 2. Deploy the server (once)

Easiest: open Google Cloud Shell with this repo at https://shell.cloud.google.com/?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fprdurgam-edu%2Fshot-coach&cloudshell_workspace=.&show=terminal and run `bash server/deploy.sh`. It asks for your project (if none is selected), your Gemini key and an access code, then prints the server address.

Or do the same by hand:

You need a Google Cloud project with billing turned on, and the Google Cloud CLI (`gcloud`). Run these in PowerShell from this folder.

First get a Gemini API key at https://aistudio.google.com/apikey, and choose any access code you like (a long random string). The app sends the code with every picture so strangers cannot use your server.

    gcloud auth login
    gcloud config set project YOUR_PROJECT_ID
    gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
    gcloud run deploy shot-coach-api --source server --region asia-south1 --allow-unauthenticated --set-env-vars "API_KEY=YOUR_ACCESS_CODE,GEMINI_API_KEY=YOUR_GEMINI_KEY"

When it finishes it prints a **Service URL** that looks like `https://shot-coach-api-xxxx-el.a.run.app`.

Prefer to use Vertex AI instead of an API key? Leave out `GEMINI_API_KEY`, and run:

    gcloud services enable aiplatform.googleapis.com
    gcloud run deploy shot-coach-api --source server --region asia-south1 --allow-unauthenticated --set-env-vars "API_KEY=YOUR_ACCESS_CODE,GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID"
    gcloud projects add-iam-policy-binding YOUR_PROJECT_ID --member "serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" --role roles/aiplatform.user

Optional settings (add to `--set-env-vars`): `GEMINI_MODEL` (default `gemini-2.5-flash`), `VERTEX_LOCATION` (default `global`), `ALLOWED_ORIGINS` (default `https://prdurgam-edu.github.io`, comma separated).

Each picture is one small image request to Gemini, and a session sends roughly one a second while the camera is on. Check current Gemini pricing and set a billing budget alert on the project.

## 3. Use it

1. Open the app on your phone, tap **Start camera**, and enter the Service URL and your access code the first time. They are remembered on that phone.
2. Pick language, who is in the shot, and framing.
3. Follow the banner. "For you" is about where to stand or point the phone. "For the group" is spoken to the people in front.
4. Hold still. When everything is fine and steady for a moment, it takes a burst of 6 frames and keeps the best one (sharpest, eyes open, smiling). The shutter button takes a photo immediately.
5. Tap the small status line under the title any time to see technical details (engine, speed, faces seen, camera movement, last error).

Answers take about a second or two to come back, so the app ignores an answer if the phone moved while it was in flight. Move, then pause, and it coaches from the new view.

## Hindi and Telugu voices

Spoken prompts use the phone's own text-to-speech voices. If the phone has no Hindi or Telugu voice, the prompts still appear on screen. Add a voice in the phone's text-to-speech or language settings.

## Using the phone for detection

Choose **On this phone** in Settings. The first load downloads the detection library and two models (about 12 MB). To bundle them for venues with poor data, run this in the folder, then push:

    mkdir -p models lib/wasm
    curl -L -o models/face_landmarker.task https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
    curl -L -o models/pose_landmarker_lite.task https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
    npm pack @mediapipe/tasks-vision@0.10.14 && tar xzf mediapipe-tasks-vision-0.10.14.tgz
    cp package/vision_bundle.mjs lib/ && cp package/wasm/* lib/wasm/

## Tuning

Thresholds (how close counts as too close, how far apart is too far) are in `coach.js` under `T`; timings are at the top of `app.js`; the wording of every prompt is in `coach.js` under `TEXT`; the instructions given to Gemini are in `server/main.py`.

## Known limits

- Cloud mode needs a data connection. At a venue with poor signal, switch to On this phone.
- Photos are frames from the camera stream, so they are lower quality than the phone's own camera app.
- The app sees faces (and whether feet are cut off in full-length mode), not what is happening in the scene, so it does not know about rituals or poses yet.
- Screen must stay on and the page open while shooting.
