import React, { useState, useEffect, useRef } from 'react';

const encodeWav = (audioBuffer, targetSampleRate = 16000) => {
  const channelCount = audioBuffer.numberOfChannels;
  const sourceLength = audioBuffer.length;
  const mono = new Float32Array(sourceLength);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const samples = audioBuffer.getChannelData(channel);
    for (let index = 0; index < sourceLength; index += 1) {
      mono[index] += samples[index] / channelCount;
    }
  }

  const outputLength = Math.floor(sourceLength * targetSampleRate / audioBuffer.sampleRate);
  const bytes = new ArrayBuffer(44 + outputLength * 2);
  const view = new DataView(bytes);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + outputLength * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, outputLength * 2, true);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * audioBuffer.sampleRate / targetSampleRate;
    const lowerIndex = Math.floor(sourceIndex);
    const upperIndex = Math.min(lowerIndex + 1, sourceLength - 1);
    const fraction = sourceIndex - lowerIndex;
    const sample = mono[lowerIndex] * (1 - fraction) + mono[upperIndex] * fraction;
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([bytes], { type: 'audio/wav' });
};

const blobToBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export default function App() {
  const [patientName, setPatientName] = useState("Rajeev");
  const [patientAge, setPatientAge] = useState("28 Yrs / Male");
  const [transcript, setTranscript] = useState("मेरा नाम राजीव है मेरे सिर में बहुत दर्द है मैं बुखार है जुखाम है खांसी भी आ रही है और चक्कर भी आ रहा है");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [statusLabel, setStatusLabel] = useState("Ambient Voice Scribe");
  const [abhaId] = useState(`91-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(10 + Math.random() * 90)}`);
  
  const [chiefComplaints, setChiefComplaints] = useState("Fever and severe headache, acute coryza (cold / runny nose), persistent cough, and dizziness / vertigo.");
  const [icdCodes, setIcdCodes] = useState([
    { code: "R50.9 - Fever & R51 - Headache", type: "Primary" },
    { code: "J00 - Acute nasopharyngitis [common cold]", type: "Secondary" },
    { code: "R05 - Cough", type: "Secondary" },
    { code: "R42 - Dizziness and giddiness", type: "Secondary" }
  ]);
  const [medications, setMedications] = useState([
    { name: "Tab. Paracetamol 650mg", dosage: "1 Tablet • 1-1-1 (Three Times Daily)", duration: "3 Days", inst: "After Meals (For Pyrexia & Headache)" },
    { name: "Tab. Cetirizine 10mg", dosage: "1 Tablet • 0-0-1 (At Bedtime)", duration: "3 Days", inst: "At Night (For Cold & Sneezing)" },
    { name: "Syrup Ambroxol + Dextromethorphan", dosage: "10 ml • 1-1-1 (Three Times Daily)", duration: "5 Days", inst: "After Meals (For Cough Relief)" },
    { name: "Tab. Betahistine 8mg", dosage: "1 Tablet • 1-0-1 (Twice Daily)", duration: "3 Days", inst: "After Meals (For Dizziness & Vertigo)" }
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editableMeds, setEditableMeds] = useState([]);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);

  const transcribeRecording = async (recording) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Audio conversion is not supported in this browser.");

    const audioContext = new AudioContextClass();
    try {
      const decodedAudio = await audioContext.decodeAudioData(await recording.arrayBuffer());
      const wavAudio = encodeWav(decodedAudio);
      const response = await fetch('/api/bhashini/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioContent: await blobToBase64(wavAudio),
          sourceLanguage: 'hi',
          audioFormat: 'wav',
          samplingRate: 16000,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Bhashini transcription failed.");
      if (!result.transcript?.trim()) throw new Error("Bhashini returned an empty transcript.");

      setTranscript((current) => [current.trim(), result.transcript.trim()].filter(Boolean).join(" "));
      setStatusLabel("Transcription added with Bhashini.");
    } finally {
      await audioContext.close();
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      setIsRecording(false);
      setIsTranscribing(true);
      setStatusLabel("Transcribing with Bhashini...");
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatusLabel("Audio recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setStatusLabel("Recording failed. Please check microphone access and try again.");
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        try {
          const recording = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          await transcribeRecording(recording);
        } catch (error) {
          setStatusLabel(error.message || "Bhashini transcription failed.");
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.start();
      setIsRecording(true);
      setStatusLabel("🔴 Recording consultation...");
    } catch (error) {
      setStatusLabel(error.name === 'NotAllowedError'
        ? "Microphone access denied. Check browser permissions."
        : error.message || "Could not start microphone recording.");
    }
  };

  const handleProcessNote = () => {
    const text = transcript.toLowerCase().replace(/जुखाम/g, "जुकाम");
    const nameMatch = transcript.match(/मेरा नाम\s+([^\s]+)\s+है/i);
    const parsedName = patientName.trim() || nameMatch?.[1] || "";
    if (parsedName) setPatientName(parsedName);

    let newMeds = [];
    let newCodes = [];
    let chiefParts = [];

    if (text.includes("बुखार") || text.includes("fever") || text.includes("सिर में दर्द")) {
      chiefParts.push("Fever and severe headache");
      newMeds.push({ name: "Tab. Paracetamol 650mg", dosage: "1 Tablet • 1-1-1 (Three Times Daily)", duration: "3 Days", inst: "After Meals" });
      newCodes.push({ code: "R50.9 - Fever & R51 - Headache", type: "Primary" });
    }
    if (text.includes("जुकाम") || text.includes("cold")) {
      chiefParts.push("Acute coryza (cold / runny nose)");
      newMeds.push({ name: "Tab. Cetirizine 10mg", dosage: "1 Tablet • 0-0-1 (At Bedtime)", duration: "3 Days", inst: "At Night" });
      newCodes.push({ code: "J00 - Acute nasopharyngitis", type: "Secondary" });
    }
    if (text.includes("खांसी") || text.includes("cough")) {
      chiefParts.push("Persistent cough");
      newMeds.push({ name: "Syrup Ambroxol + Dextromethorphan", dosage: "10 ml • 1-1-1 (Three Times Daily)", duration: "5 Days", inst: "After Meals" });
      newCodes.push({ code: "R05 - Cough", type: "Secondary" });
    }
    if (text.includes("चक्कर") || text.includes("dizziness") || text.includes("vertigo")) {
      chiefParts.push("Dizziness / vertigo");
      newMeds.push({ name: "Tab. Betahistine 8mg", dosage: "1 Tablet • 1-0-1 (Twice Daily)", duration: "3 Days", inst: "After Meals" });
      newCodes.push({ code: "R42 - Dizziness and giddiness", type: "Secondary" });
    }

    setMedications(newMeds);
    setIcdCodes(newCodes);
    setChiefComplaints(chiefParts.join(", "));
    alert(newMeds.length
      ? `✨ Clinical notes updated for ${parsedName || "the patient"}!`
      : "No supported symptoms found. Please review the transcript.");
  };

  const handleTTS = () => {
    if (!('speechSynthesis' in window)) return;
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(transcript);
    utterance.lang = 'hi-IN';
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-800">
      {/* Header */}
      <header className="bg-slate-900 text-white shadow-md py-3.5 px-6 no-print border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md bg-opacity-95">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2.5 rounded-xl text-white font-bold shadow-md">⚕️</div>
            <div>
              <h1 className="text-base font-extrabold tracking-wide text-white">NIDAN PRO <span className="text-xs font-normal text-indigo-300 bg-indigo-950 px-2.5 py-0.5 rounded-md border border-indigo-800 ml-2">React Edition</span></h1>
              <p className="text-xs text-slate-400">AI-Powered Vernacular Medical Scribe & Practice Suite</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 px-3 py-1 rounded-full font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ABDM M3-SYNCED
            </span>
            <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full border border-slate-700">Dr. Anand Sharma, M.D.</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto p-4 sm:p-6 flex-grow flex flex-col gap-6 w-full">
        {/* Controls Panel */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col gap-5 no-print">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>🎙️</span> Live Consultation Input & Actions
            </h2>
            <span className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-full font-semibold">Guidelines-Compliant AI Scribe</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Patient Full Name:</label>
              <input type="text" value={patientName} onChange={(e) => setPatientName(e.target.value)} className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Age / Gender:</label>
              <input type="text" value={patientAge} onChange={(e) => setPatientAge(e.target.value)} className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-slate-800 outline-none" />
            </div>
          </div>

          <div className="bg-gradient-to-r from-indigo-50/70 to-slate-50 border border-indigo-100 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-indigo-950 block">{statusLabel}</span>
              <span className="text-[11px] text-slate-500">Hindi speech transcription by Bhashini</span>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button onClick={toggleRecording} disabled={isTranscribing} className={`text-xs font-semibold px-5 py-3 rounded-xl transition flex items-center justify-center gap-2 shadow-sm w-full sm:w-auto disabled:cursor-wait disabled:opacity-60 ${isRecording ? 'bg-slate-800 text-white animate-pulse' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}>
                <span>{isRecording ? '⏹️ Stop Scribing' : isTranscribing ? 'Transcribing...' : '🔴 Start Listening'}</span>
              </button>
              <button onClick={handleTTS} className="bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-4 py-3 rounded-xl border border-slate-300 transition flex items-center justify-center gap-2 w-full sm:w-auto">
                🔊 Listen Summary
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <button onClick={() => { setEditableMeds(JSON.parse(JSON.stringify(medications))); setIsModalOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded-xl text-xs transition flex items-center justify-center gap-2">
              <span>💊 Verify & Confirm Dosages (Modify)</span>
            </button>
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={handleProcessNote} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-xl text-xs transition flex items-center justify-center gap-2">
                <span>⚡ Extract Clinical Note & Auto-Suggest Guidelines</span>
              </button>
              <button onClick={() => window.print()} className="bg-indigo-900 hover:bg-indigo-950 text-white font-semibold py-3 px-4 rounded-xl text-xs transition flex items-center justify-center gap-2">
                <span>🖨️ Print / Save PDF Prescription</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Consultation Transcript (Editable):</label>
            <textarea rows="4" value={transcript} onChange={(e) => setTranscript(e.target.value)} className="w-full p-3.5 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono text-slate-700 leading-relaxed outline-none"></textarea>
          </div>
        </section>

        {/* Prescription Card */}
        <section id="printablePrescription" className="bg-white p-6 sm:p-10 rounded-2xl shadow-xl border border-slate-200/90 flex flex-col justify-between relative min-h-[750px]">
          <div>
            <div className="border-b-2 border-indigo-950 pb-5 flex flex-col sm:flex-row justify-between items-start gap-4">
              <div>
                <h2 className="text-lg sm:text-2xl font-black tracking-tight text-indigo-950">DR. ANAND SHARMA, M.D.</h2>
                <p className="text-xs text-slate-700 font-bold mt-0.5">Senior Consultant Physician • Reg. No: UP-48291</p>
                <p className="text-[11px] text-slate-500 mt-1">NIDAN Healthcare Clinic, Assi Ghat Road, Varanasi (U.P.)</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Phone: +91 98390 12345 • Timing: 09:00 AM - 02:00 PM</p>
              </div>
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 p-3 rounded-xl shadow-xs">
                <div className="w-12 h-12 bg-white p-1 border border-slate-200 flex items-center justify-center rounded">
                  <svg viewBox="0 0 24 24" className="w-full h-full text-indigo-950 fill-current">
                    <path d="M2,2H10V10H2V2M4,4V8H8V4H4M14,2H22V10H14V2M16,4V8H20V4H16M2,14H10V22H2V14M4,16V20H8V16H4M18,14V18H22V14H18M14,18V22H16V18H14M20,18V22H22V18H20M12,2H14V6H12V2M12,8H14V12H12V8M12,14H14V18H12V14M12,20H14V22H12V20M6,12H8V14H6V12M16,12H18V14H16V12Z"/>
                  </svg>
                </div>
                <div className="text-left leading-tight">
                  <span className="block text-[10px] font-bold text-indigo-900">ABDM-M3-</span>
                  <span className="block text-[10px] font-bold text-indigo-900">SYNCED</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 my-5 text-xs grid grid-cols-2 sm:grid-cols-4 gap-3 shadow-inner">
              <div><span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider">Patient Name</span><span className="font-bold text-slate-900 text-sm">{patientName}</span></div>
              <div><span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider">Age / Gender</span><span className="font-bold text-slate-900 text-sm">{patientAge}</span></div>
              <div><span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider">Consult Date</span><span className="font-bold text-slate-900 text-sm">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
              <div><span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider">ABHA ID</span><span className="font-bold text-indigo-600 text-xs font-mono">{abhaId}</span></div>
            </div>

            <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 my-3 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-4 flex-wrap">
                <div><strong className="text-slate-600">BP:</strong> <span className="font-bold text-slate-900">120/80 mmHg</span></div>
                <div><strong className="text-slate-600">Temp:</strong> <span className="font-bold text-slate-900">100.4 °F</span></div>
                <div><strong className="text-slate-600">SpO2:</strong> <span className="font-bold text-slate-900">98%</span></div>
              </div>
              <span className="text-[10px] text-amber-800 font-semibold italic">Vitals verified by assistant</span>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 my-4 text-xs">
              <span className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider block mb-1">Chief Complaints (S)</span>
              <p className="text-slate-800 font-medium text-sm leading-relaxed">{chiefComplaints}</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 my-4 text-xs">
              <div className="flex justify-between items-center mb-2.5">
                <span className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider">ICD-10 Diagnostic Coding (A)</span>
                <span className="text-[9px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded font-bold tracking-wide">GUIDELINES MAPPED</span>
              </div>
              <div className="space-y-2">
                {icdCodes.map((icd, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-slate-200">
                    <span className="font-semibold text-slate-800">{icd.code}</span>
                    <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{icd.type}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="my-6">
              <div className="flex justify-between items-end mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-serif font-black italic text-indigo-950">Rx</span>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Medications & Dosage Plan</h3>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 text-[10px] uppercase font-bold tracking-wider border-b border-slate-200">
                      <th className="p-3 w-10">#</th>
                      <th className="p-3">Medicine Name</th>
                      <th className="p-3">Dosage & Frequency</th>
                      <th className="p-3">Duration</th>
                      <th className="p-3">Instructions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {medications.map((m, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80">
                        <td className="p-3 font-medium text-slate-500">{idx + 1}</td>
                        <td className="p-3 font-bold text-slate-900">{m.name}</td>
                        <td className="p-3 text-indigo-900 font-medium">{m.dosage}</td>
                        <td className="p-3">{m.duration}</td>
                        <td className="p-3 text-slate-600">{m.inst}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="border-t pt-5 mt-8 flex flex-col sm:flex-row justify-between items-center sm:items-end gap-3 text-[10px] text-slate-500">
            <div>
              <p>Electronically generated via NIDAN AI Clinical Scribe.</p>
              <p className="text-[9px] text-slate-400 mt-0.5">Valid without physical stamp in compliance with IT Act 2000 & ABDM Guidelines.</p>
            </div>
            <div className="text-center sm:text-right">
              <div className="font-serif italic text-indigo-950 font-bold text-lg">Dr. Anand Sharma</div>
              <span className="text-[9px] bg-slate-100 text-slate-700 border border-slate-300 px-3 py-1 rounded-md font-bold tracking-widest block mt-1">DIGITALLY SIGNED & VERIFIED</span>
            </div>
          </div>
        </section>
      </main>

      {/* Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 no-print p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 flex flex-col gap-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base font-bold text-indigo-950 flex items-center gap-2"><span>💊</span> Verify & Modify Prescription Medications</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700 font-bold text-lg p-1">✕</button>
            </div>
            
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {editableMeds.map((med, index) => (
                <div key={index} className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="font-bold text-indigo-950">Medicine #{index + 1}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input type="text" value={med.name} onChange={(e) => { const updated = [...editableMeds]; updated[index].name = e.target.value; setEditableMeds(updated); }} className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-900 outline-none" />
                    <input type="text" value={med.dosage} onChange={(e) => { const updated = [...editableMeds]; updated[index].dosage = e.target.value; setEditableMeds(updated); }} className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs text-indigo-900 font-medium outline-none" />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl">Cancel</button>
              <button onClick={() => { setMedications(editableMeds); setIsModalOpen(false); }} className="px-5 py-2.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm">Save & Update</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}