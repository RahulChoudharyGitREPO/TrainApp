import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const sendResponse = (res, statusCode, success, message, data = null) => {
  return res.status(statusCode).json({
    success,
    message,
    data,
  });
};

export const generateBookingPDF = async (bookingDetails) => {
  try {
    const { booking, train, user } = bookingDetails;

    // Create PDF
    const doc = new jsPDF();

    // Header with background
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 210, 40, 'F');

    // Title
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('TRAIN E-TICKET', 105, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Train Booking System', 105, 30, { align: 'center' });

    // Reset text color for body
    doc.setTextColor(0, 0, 0);

    // Booking Reference (Large and prominent)
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text('Booking Reference', 20, 55);

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(booking.bookingReference, 20, 65);

    // Status badge
    doc.setFillColor(34, 197, 94);
    doc.roundedRect(150, 50, 40, 10, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CONFIRMED', 170, 57, { align: 'center' });

    // Passenger Details Section
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('Passenger Details', 20, 80);

    doc.setDrawColor(229, 231, 235);
    doc.line(20, 82, 190, 82);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);

    doc.text(`Name: ${user.name}`, 20, 90);
    doc.text(`Email: ${user.email}`, 20, 97);
    doc.text(`Mobile: ${user.mobile}`, 20, 104);

    // Journey Details Section
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Journey Details', 20, 120);

    doc.setDrawColor(229, 231, 235);
    doc.line(20, 122, 190, 122);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    doc.text(`Train: ${train.trainName}`, 20, 132);
    doc.text(`Train Number: ${train.trainNumber}`, 20, 139);

    // Route with arrow
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${train.origin}`, 20, 150);
    doc.setFont('helvetica', 'normal');
    doc.text('→', 80, 150);
    doc.setFont('helvetica', 'bold');
    doc.text(`${train.destination}`, 90, 150);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    const departureDate = new Date(train.departureTime);
    const arrivalDate = new Date(train.arrivalTime);

    doc.text(`Departure: ${departureDate.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })}`, 20, 160);

    doc.text(`Arrival: ${arrivalDate.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })}`, 20, 167);

    doc.text(`Total Seats: ${booking.totalSeatsBooked}`, 20, 174);

    // Passengers List
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Passengers', 20, 190);

    doc.setDrawColor(229, 231, 235);
    doc.line(20, 192, 190, 192);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    let yPosition = 200;
    booking.passengers.forEach((passenger, index) => {
      doc.text(`${index + 1}. ${passenger.name} (Age: ${passenger.age})`, 25, yPosition);
      yPosition += 7;
    });

    // Generate QR Code
    const qrData = JSON.stringify({
      bookingId: booking._id.toString(),
      reference: booking.bookingReference,
      trainNumber: train.trainNumber,
      departure: train.departureTime,
      passengers: booking.totalSeatsBooked
    });

    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      width: 150,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Add QR Code to PDF
    doc.addImage(qrCodeDataUrl, 'PNG', 140, 180, 50, 50);

    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Scan for verification', 165, 235, { align: 'center' });

    // Footer
    doc.setDrawColor(229, 231, 235);
    doc.line(20, 250, 190, 250);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Important Instructions:', 20, 258);

    doc.setFontSize(8);
    doc.text('• Please arrive at the station at least 30 minutes before departure', 20, 264);
    doc.text('• Carry a valid ID proof along with this ticket', 20, 269);
    doc.text('• This is an electronic ticket, no need to print', 20, 274);

    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`Booking Date: ${new Date(booking.createdAt).toLocaleString()}`, 105, 285, { align: 'center' });
    doc.text('Train Booking System - Safe Journey!', 105, 290, { align: 'center' });

    // Generate PDF as buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    return {
      buffer: pdfBuffer,
      filename: `ticket-${booking.bookingReference}.pdf`,
      bookingId: booking._id,
      reference: booking.bookingReference,
    };
  } catch (error) {
    console.error('PDF generation error:', error);
    throw new Error('Failed to generate PDF ticket');
  }
};