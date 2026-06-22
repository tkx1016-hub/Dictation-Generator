import { jsPDF } from "jspdf";

/**
 * Generates a beautiful PDF dictation template for writing and grading.
 */
export function generateDictationPDF(
  words: string[],
  voiceGender: string,
  repeatCount: number,
  intervalSeconds: number,
  order: string
) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const dateStr = new Date().toLocaleDateString();

  // Print title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text("English Spelling Dictation Sheet", 14, 20);

  // Print subtitles
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Generated: ${dateStr}  |  Accent: British ${voiceGender === "male" ? "Male" : "Female"}`, 14, 27);
  doc.text(
    `Settings: Word count: ${words.length}  |  Repeat: ${repeatCount} times  |  Word Interval: ${intervalSeconds}s  |  Order: ${order === "random" ? "Random" : "Sequential"}`,
    14,
    33
  );

  // Divider line
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.5);
  doc.line(14, 38, 196, 38);

  // Table header Setup
  const startX = 14;
  const startY = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105); // slate-600

  doc.text("No.", startX, startY);
  doc.text("Dictation Practice Area (Write your spelling here)", startX + 12, startY);
  doc.text("Correct Spelling (Answer Key)", startX + 115, startY);
  doc.text("Grade", startX + 170, startY);

  // Header bottom border
  doc.setDrawColor(148, 163, 184); // slate-400
  doc.setLineWidth(0.7);
  doc.line(14, startY + 3, 196, startY + 3);

  let currentY = startY + 12;

  // Render rows
  words.forEach((word, index) => {
    // If near the page end, insert a page break
    if (currentY > 275) {
      doc.addPage();
      currentY = 25;

      // Table header repeating on next page
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105); // slate-600

      doc.text("No.", startX, currentY);
      doc.text("Dictation Practice Area (Write your spelling here)", startX + 12, currentY);
      doc.text("Correct Spelling (Answer Key)", startX + 115, currentY);
      doc.text("Grade", startX + 170, currentY);

      doc.setDrawColor(148, 163, 184); // slate-400
      doc.setLineWidth(0.7);
      doc.line(14, currentY + 3, 196, currentY + 3);

      currentY += 12;
    }

    // Row zebra background striping
    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252); // slate-50
      doc.rect(14, currentY - 5, 182, 9, "F");
    }

    // 1. Row Index Number
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(String(index + 1).padStart(2, "0"), startX + 1, currentY);

    // 2. Handwriting Underline (for students to physically write their dictation)
    doc.setDrawColor(203, 213, 225); // slate-300
    doc.setLineWidth(0.3);
    doc.line(startX + 12, currentY + 1, startX + 105, currentY + 1);

    // 3. Correct Answer Column (Right side)
    doc.setFont("helvetica", "semibold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(word, startX + 115, currentY);

    // 4. Score grading square (CheckBox)
    doc.setDrawColor(148, 163, 184); // slate-400
    doc.setLineWidth(0.4);
    doc.rect(startX + 172, currentY - 4.5, 5, 5);

    // Increment Y for the next word
    currentY += 10;
  });

  // Stamp clean footer and page count
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(`Page ${i} of ${pageCount}`, 105, 287, { align: "center" });
    doc.text("Practicing vocab daily builds retention. | English Spelling Dictation System", 14, 287);
  }

  doc.save(`English_Dictation_${dateStr}.pdf`);
}
