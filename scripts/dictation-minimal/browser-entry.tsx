import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import OpenAIDictationBox from "../../components/report-writing/OpenAIDictationBox";
function Harness() {
  const [name, setName] = useState("Fixture"),
    [text, setText] = useState("");
  Object.assign(window, { editLetter: setText, changePatient: setName });
  return (
    <>
      <OpenAIDictationBox
        providerId="00000000-0000-4000-8000-000000000002"
        patientFirstName="Synthetic"
        patientLastName={name}
        existingText={text}
        onFinished={(value) => {
          setText(value);
          Object.assign(window, {
            appliedCount:
              ((window as unknown as { appliedCount?: number }).appliedCount ||
                0) + 1,
          });
        }}
      />
      <div id="letter">{text}</div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
