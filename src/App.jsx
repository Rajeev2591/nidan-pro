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
    <div className="app-shell min-vh-100 d-flex flex-column">
      <header className="navbar app-navbar no-print">
        <div className="container-xl d-flex justify-content-between align-items-center gap-3">
          <a className="navbar-brand d-flex align-items-center gap-3 m-0" href="#workspace">
            <span className="brand-mark" aria-hidden="true">N</span>
            <span>
              <span className="brand-name d-block">NIDAN <span>PRO</span></span>
              <span className="brand-caption d-block">Clinical documentation workspace</span>
            </span>
          </a>
          <div className="d-flex align-items-center gap-3">
            <span className="abdm-badge"><span className="abdm-dot" /> ABDM M3 synced</span>
            <div className="clinician-chip d-none d-sm-flex align-items-center gap-2">
              <span className="clinician-avatar">AS</span>
              <span>Dr. Anand Sharma</span>
            </div>
          </div>
        </div>
      </header>

      <main id="workspace" className="container-xl flex-grow-1 py-4 py-lg-5">
        <div className="workspace-heading d-flex flex-column flex-md-row justify-content-between align-items-md-end gap-3 mb-4">
          <div>
            <div className="section-kicker">CLINIC / CONSULTATION</div>
            <h1 className="workspace-title mb-1">Consultation workspace</h1>
            <p className="workspace-subtitle mb-0">Capture the visit, review the note, and prepare the prescription.</p>
          </div>
          <div className="session-indicator"><span className="session-indicator-dot" /> Active session <span className="session-divider">/</span> {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
        </div>

        <div className="row g-4 align-items-start">
          <div className="col-12 col-xl-5 no-print">
            <section className="card workspace-card h-100" aria-labelledby="consultation-heading">
              <div className="card-header workspace-card-header">
                <div>
                  <div className="section-kicker">VISIT DETAILS</div>
                  <h2 id="consultation-heading" className="card-title mb-0">Consultation input</h2>
                </div>
                <span className="soft-badge">Hindi · Bhashini</span>
              </div>
              <div className="card-body d-flex flex-column gap-4">
                <div className="row g-3">
                  <div className="col-12 col-sm-7">
                    <label className="form-label" htmlFor="patient-name">Patient name</label>
                    <input id="patient-name" type="text" value={patientName} onChange={(e) => setPatientName(e.target.value)} className="form-control" autoComplete="name" />
                  </div>
                  <div className="col-12 col-sm-5">
                    <label className="form-label" htmlFor="patient-age">Age / gender</label>
                    <input id="patient-age" type="text" value={patientAge} onChange={(e) => setPatientAge(e.target.value)} className="form-control" />
                  </div>
                </div>

                <div className={`recording-panel ${isRecording ? 'recording-active' : ''} ${isTranscribing ? 'recording-pending' : ''}`}>
                  <div className="d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-3">
                    <div className="d-flex align-items-center gap-3">
                      <span className="recording-indicator" aria-hidden="true" />
                      <div>
                        <div className="recording-title" aria-live="polite">{statusLabel}</div>
                        <div className="recording-caption">Speech transcription by Bhashini</div>
                      </div>
                    </div>
                    <div className="d-flex flex-column flex-sm-row gap-2">
                      <button onClick={toggleRecording} disabled={isTranscribing} className={`btn ${isRecording ? 'btn-recording-stop' : 'btn-primary'} recording-button`}>
                        {isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing…' : 'Start recording'}
                      </button>
                      <button onClick={handleTTS} className="btn btn-outline-secondary recording-button">Listen to transcript</button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="form-label" htmlFor="consultation-transcript">Consultation transcript</label>
                  <textarea id="consultation-transcript" rows="7" value={transcript} onChange={(e) => setTranscript(e.target.value)} className="form-control transcript-field" />
                  <div className="form-text">Review and edit the transcript before extracting the clinical note.</div>
                </div>

                <div className="action-stack">
                  <button onClick={handleProcessNote} className="btn btn-primary w-100">Extract clinical note</button>
                  <button onClick={() => { setEditableMeds(JSON.parse(JSON.stringify(medications))); setIsModalOpen(true); }} className="btn btn-outline-primary w-100">Review medication plan</button>
                  <button onClick={() => window.print()} className="btn btn-outline-secondary w-100">Print / save prescription</button>
                </div>
              </div>
            </section>
          </div>

          <div className="col-12 col-xl-7">
            <section id="printablePrescription" className="card prescription-card" aria-labelledby="prescription-heading">
              <div className="prescription-header">
                <div className="d-flex flex-column flex-sm-row justify-content-between gap-3">
                  <div>
                    <div className="prescription-label">NIDAN HEALTHCARE CLINIC</div>
                    <h2 id="prescription-heading" className="doctor-name">Dr. Anand Sharma, M.D.</h2>
                    <p className="doctor-credential mb-1">Senior Consultant Physician <span>·</span> Reg. No: UP-48291</p>
                    <p className="doctor-address mb-0">Assi Ghat Road, Varanasi, Uttar Pradesh <span>·</span> +91 98390 12345</p>
                  </div>
                  <div className="prescription-verification">
                    <div className="qr-mark" aria-label="ABDM QR mark">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M2 2h8v8H2V2Zm2 2v4h4V4H4Zm10-2h8v8h-8V2Zm2 2v4h4V4h-4ZM2 14h8v8H2v-8Zm2 2v4h4v-4H4Zm10-2h3v3h-3v-3Zm4 0h4v2h-2v2h-2v-4Zm-4 5h2v3h-2v-3Zm4 1h4v2h-4v-2Z" />
                      </svg>
                    </div>
                    <span className="abdm-badge abdm-badge-light"><span className="abdm-dot" /> ABDM M3 synced</span>
                  </div>
                </div>
              </div>

              <div className="card-body prescription-body">
                <div className="patient-summary row g-3">
                  <div className="col-6 col-md-3"><div className="meta-label">Patient</div><div className="meta-value">{patientName || '—'}</div></div>
                  <div className="col-6 col-md-3"><div className="meta-label">Age / gender</div><div className="meta-value">{patientAge || '—'}</div></div>
                  <div className="col-6 col-md-3"><div className="meta-label">Visit date</div><div className="meta-value">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div></div>
                  <div className="col-6 col-md-3"><div className="meta-label">ABHA ID</div><div className="meta-value abha-value">{abhaId}</div></div>
                </div>

                <div className="vitals-strip row g-0" aria-label="Patient vitals">
                  <div className="col-4 vital-item"><span className="vital-label">Blood pressure</span><strong>120/80 <small>mmHg</small></strong></div>
                  <div className="col-4 vital-item"><span className="vital-label">Temperature</span><strong>100.4 <small>°F</small></strong></div>
                  <div className="col-4 vital-item"><span className="vital-label">SpO2</span><strong>98<small>%</small></strong></div>
                  <div className="vitals-note">Vitals verified by assistant</div>
                </div>

                <section className="clinical-section">
                  <div className="section-heading">
                    <span className="soap-index">S</span>
                    <div><div className="section-kicker">SUBJECTIVE</div><h3>Chief complaints</h3></div>
                  </div>
                  <p className="complaints-copy mb-0">{chiefComplaints || 'No complaints extracted.'}</p>
                </section>

                <section className="clinical-section">
                  <div className="section-heading d-flex justify-content-between align-items-center">
                    <div className="d-flex align-items-center gap-3">
                      <span className="soap-index">A</span>
                      <div><div className="section-kicker">ASSESSMENT</div><h3>Diagnostic coding</h3></div>
                    </div>
                    <span className="soft-badge">ICD-10</span>
                  </div>
                  {icdCodes.length > 0 ? (
                    <div className="diagnosis-list">
                      {icdCodes.map((icd, idx) => (
                        <div key={`${icd.code}-${idx}`} className="diagnosis-row">
                          <span className="diagnosis-code">{icd.code}</span>
                          <span className={`badge ${icd.type === 'Primary' ? 'text-bg-primary' : 'text-bg-light'}`}>{icd.type}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="empty-note mb-0">No diagnostic codes extracted.</p>}
                </section>

                <section className="clinical-section medication-section">
                  <div className="section-heading d-flex justify-content-between align-items-center">
                    <div className="d-flex align-items-center gap-3">
                      <span className="rx-symbol">Rx</span>
                      <div><div className="section-kicker">TREATMENT PLAN</div><h3>Medications</h3></div>
                    </div>
                    <span className="medication-count">{medications.length} items</span>
                  </div>
                  <div className="table-responsive prescription-table-wrap">
                    <table className="table table-sm align-middle prescription-table mb-0">
                      <thead>
                        <tr><th scope="col">#</th><th scope="col">Medicine</th><th scope="col">Dosage & frequency</th><th scope="col">Duration</th><th scope="col">Instructions</th></tr>
                      </thead>
                      <tbody>
                        {medications.length > 0 ? medications.map((medication, idx) => (
                          <tr key={`${medication.name}-${idx}`}>
                            <td className="row-number">{idx + 1}</td>
                            <td className="medicine-name">{medication.name}</td>
                            <td>{medication.dosage}</td>
                            <td>{medication.duration}</td>
                            <td>{medication.inst}</td>
                          </tr>
                        )) : <tr><td colSpan="5" className="empty-note text-center py-4">No medications extracted.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <footer className="prescription-footer d-flex flex-column flex-sm-row justify-content-between align-items-sm-end gap-3">
                <div>
                  <div className="footer-note">Electronically generated clinical document.</div>
                  <div className="footer-disclaimer">Review all findings and medication instructions before signing.</div>
                </div>
                <div className="signature-block">
                  <div className="signature-name">Dr. Anand Sharma</div>
                  <span className="signature-status">Digitally signed & verified</span>
                </div>
              </footer>
            </section>
          </div>
        </div>
      </main>

      {isModalOpen && (
        <>
          <div className="modal-backdrop show no-print" onClick={() => setIsModalOpen(false)} />
          <div className="modal d-block no-print" role="dialog" aria-modal="true" aria-labelledby="medication-modal-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsModalOpen(false); }}>
            <div className="modal-dialog modal-dialog-centered modal-lg">
              <div className="modal-content medication-modal">
                <div className="modal-header">
                  <div><div className="section-kicker">PRESCRIPTION REVIEW</div><h2 id="medication-modal-title" className="modal-title fs-5">Verify medications</h2></div>
                  <button type="button" className="btn-close" aria-label="Close" onClick={() => setIsModalOpen(false)} />
                </div>
                <div className="modal-body">
                  <div className="medication-edit-list">
                    {editableMeds.map((medication, index) => (
                      <div key={`${medication.name}-${index}`} className="medication-edit-row">
                        <div className="edit-row-title">Medication {index + 1}</div>
                        <div className="row g-3">
                          <div className="col-12 col-md-6">
                            <label className="form-label" htmlFor={`med-name-${index}`}>Medicine name</label>
                            <input id={`med-name-${index}`} type="text" value={medication.name} onChange={(e) => { const updated = [...editableMeds]; updated[index].name = e.target.value; setEditableMeds(updated); }} className="form-control" />
                          </div>
                          <div className="col-12 col-md-6">
                            <label className="form-label" htmlFor={`med-dose-${index}`}>Dosage & frequency</label>
                            <input id={`med-dose-${index}`} type="text" value={medication.dosage} onChange={(e) => { const updated = [...editableMeds]; updated[index].dosage = e.target.value; setEditableMeds(updated); }} className="form-control" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-outline-secondary">Cancel</button>
                  <button type="button" onClick={() => { setMedications(editableMeds); setIsModalOpen(false); }} className="btn btn-primary">Save medication plan</button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}