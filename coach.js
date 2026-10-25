// Shot Coach: framing rules and wording.
// Pure functions only (no DOM, no camera), so they can be tested on their own.
//
// Coordinates are normalised 0..1 across the video frame, in the same
// orientation the person sees on screen (x flipped already for the front camera).

// Highest priority first. The coach speaks only the first issue that persists.
export const ISSUE_ORDER = [
  'noFaces',
  'fewFaces',
  'feetCut',
  'stepBack',
  'stepCloser',
  'panLeft',
  'panRight',
  'tiltUp',
  'tiltDown',
  'closerTogether',
  'eyesClosed',
  'smile',
];

// A shot is allowed to fire when none of these are present.
// 'smile' is only a nudge and never blocks the shutter.
export const BLOCKING = new Set(ISSUE_ORDER.filter((k) => k !== 'smile'));

// Who the instruction is addressed to: the person holding the phone, or the people in front of it.
export const AUDIENCE = {
  noFaces: 'you',
  fewFaces: 'group',
  feetCut: 'you',
  stepBack: 'you',
  stepCloser: 'you',
  panLeft: 'you',
  panRight: 'you',
  tiltUp: 'you',
  tiltDown: 'you',
  closerTogether: 'group',
  eyesClosed: 'group',
  smile: 'group',
};

export const LANGS = {
  en: { label: 'English', speech: 'en-IN', fallbackSpeech: ['en-US', 'en-GB', 'en'] },
  hi: { label: 'हिन्दी', speech: 'hi-IN', fallbackSpeech: ['hi'] },
  te: { label: 'తెలుగు', speech: 'te-IN', fallbackSpeech: ['te'] },
};

export const TEXT = {
  en: {
    noFaces: "I can't see anyone yet. Point the camera at the group.",
    fewFaces: 'I can only see one person. Bring everyone into the frame.',
    feetCut: "Step back so everyone's feet fit in.",
    stepBack: 'Step back a couple of steps.',
    stepCloser: 'Step a little closer.',
    panLeft: 'Turn the phone a little to the left.',
    panRight: 'Turn the phone a little to the right.',
    tiltUp: 'Tilt the phone up a little.',
    tiltDown: 'Tilt the phone down a little.',
    closerTogether: 'Everyone, move a little closer together.',
    eyesClosed: "Someone's eyes are closed. Eyes open, please.",
    smile: 'Lovely! Now a big smile, everyone.',
    hold: 'Perfect. Hold still.',
    captured: 'Got it!',
    looking: 'Looking good',
  },
  hi: {
    noFaces: 'अभी कोई नज़र नहीं आ रहा। कैमरा ग्रुप की तरफ़ करें।',
    fewFaces: 'सिर्फ़ एक व्यक्ति दिख रहा है। सब लोग फ़्रेम में आइए।',
    feetCut: 'थोड़ा पीछे जाएँ ताकि सबके पैर भी आ जाएँ।',
    stepBack: 'दो कदम पीछे जाएँ।',
    stepCloser: 'थोड़ा पास आएँ।',
    panLeft: 'फ़ोन को थोड़ा बाईं ओर घुमाएँ।',
    panRight: 'फ़ोन को थोड़ा दाईं ओर घुमाएँ।',
    tiltUp: 'फ़ोन को थोड़ा ऊपर झुकाएँ।',
    tiltDown: 'फ़ोन को थोड़ा नीचे झुकाएँ।',
    closerTogether: 'सब लोग थोड़ा पास-पास आ जाइए।',
    eyesClosed: 'किसी की आँखें बंद हैं। आँखें खोलिए।',
    smile: 'बहुत अच्छे! अब सब मुस्कुराइए।',
    hold: 'बिल्कुल सही। स्थिर रहिए।',
    captured: 'हो गया!',
    looking: 'बहुत अच्छा लग रहा है',
  },
  te: {
    noFaces: 'ఇంకా ఎవరూ కనిపించడం లేదు. కెమెరాను గ్రూప్ వైపు తిప్పండి.',
    fewFaces: 'ఒక్కరే కనిపిస్తున్నారు. అందరూ ఫ్రేమ్‌లోకి రండి.',
    feetCut: 'అందరి పాదాలు ఫ్రేమ్‌లో రావడానికి కొంచెం వెనక్కి వెళ్లండి.',
    stepBack: 'రెండు అడుగులు వెనక్కి వెళ్లండి.',
    stepCloser: 'కొంచెం దగ్గరకు రండి.',
    panLeft: 'ఫోన్‌ను కొంచెం ఎడమవైపు తిప్పండి.',
    panRight: 'ఫోన్‌ను కొంచెం కుడివైపు తిప్పండి.',
    tiltUp: 'ఫోన్‌ను కొంచెం పైకి వంచండి.',
    tiltDown: 'ఫోన్‌ను కొంచెం కిందికి వంచండి.',
    closerTogether: 'అందరూ కొంచెం దగ్గరగా రండి.',
    eyesClosed: 'ఎవరిదో కళ్ళు మూసి ఉన్నాయి. కళ్ళు తెరవండి.',
    smile: 'చాలా బాగుంది! ఇప్పుడు అందరూ నవ్వండి.',
    hold: 'చాలా బాగుంది. కదలకండి.',
    captured: 'అయింది!',
    looking: 'బాగా కనిపిస్తోంది',
  },
};

// Thresholds in one place so they are easy to tune after real-world tests.
export const T = {
  edge: 0.03, // a face this close to the frame edge counts as cut off
  centerLow: 0.34, // group centre left of this: pan left
  centerHigh: 0.66, // group centre right of this: pan right
  headroomMin: 0.06, // top of the highest head closer than this to the top edge
  headroomMax: { upper: 0.4, full: 0.25 }, // too much empty space above the heads
  tooWide: 0.9, // faces spread over more than this: step back
  tooSmall: { solo: 0.12, couple: 0.2, group: 0.3 }, // spread of faces below this: step closer
  fullBodyScale: 0.5, // in full-body framing faces look smaller, so relax tooSmall
  gapRatio: { couple: 2.6, group: 3.4 }, // gap between head centres, in face widths
  blinkClosed: 0.55, // eyeBlink blendshape average above this = eyes closed
  smileLow: 0.25, // mouthSmile blendshape average below this = not smiling
  smileShare: 0.5, // ask for a smile when this share of faces are not smiling
};

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

// Reduce 33 pose landmarks to what the rules need.
export function bodyFromLandmarks(lm) {
  const ok = (p) =>
    !!p && (p.visibility === undefined || p.visibility > 0.5) && p.y > 0 && p.y < 0.98 && p.x > 0 && p.x < 1;
  return { feetVisible: ok(lm[27]) || ok(lm[28]) };
}

/**
 * @param frame { faces: [{minX,maxX,minY,maxY,smile,blink}], bodies?: [{feetVisible}] }
 * @param opts  { subjects: 'solo'|'couple'|'group', framing: 'upper'|'full', askSmile: boolean }
 * @returns { issues: string[] in priority order, stats }
 */
export function analyze(frame, opts = {}) {
  const subjects = opts.subjects || 'group';
  const framing = opts.framing || 'upper';
  const askSmile = opts.askSmile !== false;
  const faces = frame.faces || [];
  const found = new Set();

  if (!faces.length) {
    return { issues: ['noFaces'], stats: { count: 0 } };
  }

  const minX = Math.min(...faces.map((f) => f.minX));
  const maxX = Math.max(...faces.map((f) => f.maxX));
  const minY = Math.min(...faces.map((f) => f.minY));
  const width = maxX - minX;
  const cx = (minX + maxX) / 2;
  const avgFaceW = mean(faces.map((f) => f.maxX - f.minX));
  const stats = { count: faces.length, minX, maxX, minY, width, cx, avgFaceW };

  if (subjects !== 'solo' && faces.length < 2) found.add('fewFaces');

  if (framing === 'full' && (frame.bodies || []).some((b) => b.feetVisible === false)) {
    found.add('feetCut');
  }

  // Distance
  const cutLeft = minX < T.edge;
  const cutRight = maxX > 1 - T.edge;
  if ((cutLeft && cutRight) || width > T.tooWide) found.add('stepBack');
  const small = T.tooSmall[subjects] * (framing === 'full' ? T.fullBodyScale : 1);
  if (!found.has('stepBack') && !found.has('fewFaces') && width < small && faces.length >= (subjects === 'solo' ? 1 : 2)) {
    // A solo face is judged by its own width, groups by how much of the frame they use.
    found.add('stepCloser');
  }

  // Sideways framing
  if (!found.has('stepBack')) {
    if (cutLeft || cx < T.centerLow) found.add('panLeft');
    else if (cutRight || cx > T.centerHigh) found.add('panRight');
  }

  // Vertical framing
  if (minY < T.headroomMin) found.add('tiltUp');
  else if (minY > T.headroomMax[framing]) found.add('tiltDown');

  // Spacing between neighbours
  if (subjects !== 'solo' && faces.length >= 2) {
    const centres = faces.map((f) => (f.minX + f.maxX) / 2).sort((a, b) => a - b);
    let widest = 0;
    for (let i = 1; i < centres.length; i++) widest = Math.max(widest, centres[i] - centres[i - 1]);
    if (widest > T.gapRatio[subjects] * avgFaceW) found.add('closerTogether');
  }

  // Faces
  if (faces.some((f) => (f.blink ?? 0) > T.blinkClosed)) found.add('eyesClosed');
  if (askSmile) {
    const flat = faces.filter((f) => (f.smile ?? 1) < T.smileLow).length;
    if (flat / faces.length >= T.smileShare) found.add('smile');
  }

  return { issues: ISSUE_ORDER.filter((k) => found.has(k)), stats };
}

// Shot score used to pick the best frame from a burst. Higher is better.
export function scoreShot({ sharpness, faces }) {
  const sharp = sharpness / (sharpness + 60); // squashes Laplacian variance into 0..1
  if (!faces.length) return sharp * 0.5;
  const open = faces.filter((f) => (f.blink ?? 0) <= T.blinkClosed).length / faces.length;
  const smile = mean(faces.map((f) => Math.min(1, (f.smile ?? 0) * 1.5)));
  return sharp * 0.5 + open * 0.35 + smile * 0.15 - (open < 1 ? 0.4 : 0);
}
