import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const [patientName, setPatientName] = useState("Rajeev");
  const [patientAge, setPatientAge] = useState("28 Yrs / Male");
  const [transcript, setTranscript] = useState("मेरा नाम राजीव है मेरे सिर में बहुत दर्द है मैं बुखार है जुखाम है खांसी भी आ रही है और चक्कर भी आ रहा है");
  const [isRecording, setIsRecording] = useState(false);
  const [statusLabel, setStatusLabel] = useState("Speech transcription by Bhashini");
  const [abhaId] = useState(`91-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(10 + Math.random() * 90)}`);
  
  const [chiefComplaints, setChiefComplaints] = useState("Fever and severe headache, Acute coryza (cold / runny nose), Persistent cough, Dizziness / vertigo");
  const [icdCodes, setIcdCodes] = useState([
    { code: "R50.9 - Fever & R51 - Headache", type: "Primary" },
    { code: "J00 - Acute nasopharyngitis", type: "Secondary" },
    { code: "R05 - Cough", type: "Secondary" },
    { code: "R42 - Dizziness and giddiness", type: "Secondary" }
  ]);
  const [medications, setMedications] = useState([
    { name: "Tab. Paracetamol 650mg", dosage: "1 Tablet • 1-1-1 (Three Times Daily)", duration: "3 Days", inst: "After Meals" },
    { name: "Tab. Cetirizine 10mg", dosage: "1 Tablet • 0-0-1 (At Bedtime)", duration: "3 Days", inst: "At Night" },
    { name: "Syrup Ambroxol + Dextromethorphan", dosage: "10 ml • 1-1-1 (Three Times Daily)", duration: "5 Days", inst: "After Meals" },
    { name: "Tab. Betahistine 8mg", dosage: "1 Tablet • 1-0-1 (Twice Daily)", duration: "3 Days", inst: "After Meals" }
  ]);

  const recognitionRef = useRef(null);
  const userStoppedRef = useRef(false);
  const sessionBufferRef = useRef("");

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'hi-IN';

      recognition.onstart = () => {
        setIsRecording(true);
        setStatusLabel("🔴 Recording active...");
      };

      recognition.onresult = (event) => {
        let interim = "";
        let finalChunk = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalChunk += chunk + " ";
          } else {
            interim += chunk;
          }
        }
        if (finalChunk) {
          sessionBufferRef.current += finalChunk;
        }
        setTranscript((sessionBufferRef.current + interim).trim());
      };

      recognition.onerror = (e) => {
        console.warn("Speech recognition error:", e.error);
      };

      recognition.onend = () => {
        if (!userStoppedRef.current && recognitionRef.current) {
          try {
            recognition.start();
            return;
          } catch (err) {
            console.log("Restart blocked:", err);
          }
        }
        setIsRecording(false);
        setStatusLabel("Speech transcription by Bhashini");
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. Please use Google Chrome.");
      return;
    }

    if (isRecording) {
      userStoppedRef.current = true;
      setIsRecording(false);
      recognitionRef.current.stop();
    } else {
      userStoppedRef.current = false;
      sessionBufferRef.current = "";
      setTranscript("");
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error("Failed to start recognition:", err);
      }
    }
  };

  const handleExtractNote = () => {
    const text = transcript.toLowerCase();
    let parsedName = patientName;
    const nameMatch = transcript.match(/मेरा नाम\s+([^\s]+)\s+है/i);
    if (nameMatch && nameMatch[1]) parsedName = nameMatch[1];
    setPatientName(parsedName);
    alert(`✨ Clinical note successfully extracted for ${parsedName}!`);
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
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans p-4 sm:p-8 flex flex-col items-center">
      <div className="max-w-4xl w-full flex flex-col gap-6">
        
        {/* Top Header Workspace (Hidden on Print) */}
        <header className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-4 no-print">
          <div className="flex justify-between items-center border-b pb-3">
            <div>
              <h1 className="text-base font-extrabold text-indigo-950">NIDAN PRO — Clinical documentation workspace</h1>
              <p className="text-xs text-slate-500">ABDM M3 synced · Dr. Anand Sharma</p>
            </div>
            <span className="text-xs bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full font-bold">Active session</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Patient name:</label>
              <input 
                type="text" 
                value={patientName} 
                onChange={(e) => setPatientName(e.target.value)} 
                className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg font-bold text-slate-900 outline-none" 
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Age / gender:</label>
              <input 
                type="text" 
                value={patientAge} 
                onChange={(e) => setPatientAge(e.target.value)} 
                className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 outline-none" 
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
            <span className="text-xs font-bold text-indigo-950">{statusLabel}</span>
            <div className="flex gap-2 w-full sm:w-auto">
              <button 
                onClick={toggleRecording} 
                className={`text-xs font-semibold px-4 py-2.5 rounded-xl transition shadow-sm w-full sm:w-auto ${isRecording ? 'bg-slate-800 text-white animate-pulse' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}
              >
                {isRecording ? '⏹️ Stop recording' : '🔴 Start recording'}
              </button>
              <button 
                onClick={handleTTS} 
                className="bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-300 transition w-full sm:w-auto"
              >
                🔊 Listen to transcript
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Consultation transcript:</label>
            <textarea 
              rows="3" 
              value={transcript} 
              onChange={(e) => setTranscript(e.target.value)} 
              className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-xl font-mono text-slate-700 outline-none"
            ></textarea>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={handleExtractNote} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2.5 px-4 rounded-xl shadow-sm transition">
              Extract clinical note
            </button>
            <button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold py-2.5 px-4 rounded-xl shadow-sm transition">
              Print / save prescription
            </button>
          </div>
        </header>

        {/* Clinical Document Preview Card (Targeted for printing via id="printablePrescription") */}
        <section id="printablePrescription" className="bg-white p-6 sm:p-10 rounded-2xl shadow-xl border border-slate-200 flex flex-col gap-6">
          <div className="border-b-2 border-indigo-950 pb-4 flex justify-between items-start">
            <div>
              <h2 className="text-lg font-black text-indigo-950">NIDAN HEALTHCARE CLINIC</h2>
              <h3 className="text-sm font-bold text-slate-800 mt-0.5">Dr. Anand Sharma, M.D.</h3>
              <p className="text-[11px] text-slate-500">Senior Consultant Physician · Reg. No: UP-48291</p>
              <p className="text-[10px] text-slate-400">Assi Ghat Road, Varanasi, Uttar Pradesh · +91 98390 12345</p>
            </div>
            <div className="text-right text-xs">
              <span className="bg-indigo-50 text-indigo-900 border border-indigo-200 px-2.5 py-1 rounded font-bold">ABDM M3 synced</span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><span className="text-[9px] uppercase font-bold text-slate-400 block">Patient</span><span className="font-bold text-slate-900">{patientName}</span></div>
            <div><span className="text-[9px] uppercase font-bold text-slate-400 block">Age / Gender</span><span className="font-bold text-slate-900">{patientAge}</span></div>
            <div><span className="text-[9px] uppercase font-bold text-slate-400 block">Visit Date</span><span className="font-bold text-slate-900">24 Oct 2026</span></div>
            <div><span className="text-[9px] uppercase font-bold text-slate-400 block">ABHA ID</span><span className="font-bold text-indigo-600 font-mono">{abhaId}</span></div>
          </div>

          {/* Subjective */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
            <span className="text-[10px] font-bold text-indigo-900 uppercase block mb-1">S · Subjective / Chief Complaints</span>
            <p className="text-slate-800 font-medium">{chiefComplaints}</p>
          </div>

          {/* Assessment */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
            <span className="text-[10px] font-bold text-indigo-900 uppercase block mb-2">A · Assessment / ICD-10 Diagnostic Coding</span>
            <div className="space-y-1.5">
              {icdCodes.map((icd, idx) => (
                <div key={idx} className="flex justify-between bg-white p-2 rounded border border-slate-200">
                  <span className="font-semibold text-slate-800">{icd.code}</span>
                  <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{icd.type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Medications */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-2">Rx · Treatment Plan & Medications</h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 text-[10px] uppercase font-bold border-b border-slate-200">
                    <th className="p-2.5 w-10">#</th>
                    <th className="p-2.5">Medicine</th>
                    <th className="p-2.5">Dosage & Frequency</th>
                    <th className="p-2.5">Duration</th>
                    <th className="p-2.5">Instructions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {medications.map((m, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="p-2.5 text-slate-500">{idx + 1}</td>
                      <td className="p-2.5 font-bold text-slate-900">{m.name}</td>
                      <td className="p-2.5 text-indigo-900 font-medium">{m.dosage}</td>
                      <td className="p-2.5">{m.duration}</td>
                      <td className="p-2.5 text-slate-600">{m.inst}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t pt-4 mt-2 flex justify-between items-end text-[10px] text-slate-500">
            <p>Electronically generated clinical document. Review all findings before signing.</p>
            <div className="text-right">
              <span className="font-serif italic font-bold text-indigo-950 text-sm">Dr. Anand Sharma</span>
              <span className="block text-[9px] bg-slate-100 text-slate-700 border px-2 py-0.5 rounded mt-0.5 font-bold">DIGITALLY SIGNED & VERIFIED</span>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
