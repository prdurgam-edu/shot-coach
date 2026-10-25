# Shot Coach

A web app that coaches the person holding the phone (and the people being photographed), then takes the shot.
Camera, face and pose detection all run on the phone. Prompts are spoken and shown in English, Hindi and Telugu.

## Put it online (about a minute)

The camera only works on an https address, so the folder has to be hosted.

1. Go to https://app.netlify.com/drop and drag this whole folder onto the page.
2. Open the link it gives you on your phone, tap **Start camera**, and allow the camera.

GitHub Pages or any other static host works too. Do not open index.html straight from a file.

## Use it

- Pick language, who is in the shot, and framing, then **Start camera**.
- Follow the banner. "For you" is about where to stand or point the phone. "For the group" is spoken to the people in front.
- When everything is fine and steady, a bar fills and it takes a burst of 6 frames and keeps the best one (sharpest, eyes open, smiling).
- The shutter takes a photo immediately. The thumbnail opens the photos, where you can save or share them.
- Speaker icon: voice on or off. Turn it off at ceremonies. Settings: "Ask for smiles" can be switched off for solemn moments.

## Hindi and Telugu voices

Spoken prompts use the phone's own text-to-speech voices. If the phone has no Hindi or Telugu voice, the prompts still appear on screen.
Add a voice in the phone's text-to-speech or language settings (on Android, Google Speech Services offers Hindi and Telugu).

## Working with little internet

The first load downloads the detection library and two models (about 12 MB). To bundle them with the app, run this in the folder on your computer, then redeploy:

    mkdir -p models lib/wasm
    curl -L -o models/face_landmarker.task https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
    curl -L -o models/pose_landmarker_lite.task https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
    npm pack @mediapipe/tasks-vision@0.10.14 && tar xzf mediapipe-tasks-vision-0.10.14.tgz
    cp package/vision_bundle.mjs lib/ && cp package/wasm/* lib/wasm/

The app uses these files automatically when they are present.

## Tuning

All thresholds (how close counts as too close, how far apart is too far, how long it waits before shooting) are in `coach.js` under `T`, and timings are at the top of `app.js`. The wording of every prompt is in `coach.js` under `TEXT`.

## Known limits of this version

- Photos are frames from the camera stream, so they are lower quality than the phone's own camera app. A later version can use the full-resolution photo mode on Chrome for Android.
- It sees faces (and bodies in full-length mode), not what the scene is, so it does not know about rituals or poses yet. The pose library is the next step.
- Screen must stay on and the page open while shooting.
