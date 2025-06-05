const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Write credentials to a temporary file
const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
console.log('GOOGLE_APPLICATION_CREDENTIALS_JSON:', credentialsJson);

let credentials;
try {
  credentials = JSON.parse(credentialsJson);
  console.log('Parsed credentials:', credentials);
} catch (error) {
  console.error('Error parsing GOOGLE_APPLICATION_CREDENTIALS_JSON:', error);
  throw error;
}

// Write credentials to a temporary file
const tempCredentialsPath = path.join('/tmp', 'gcloud-credentials.json');
try {
  fs.writeFileSync(tempCredentialsPath, JSON.stringify(credentials));
  console.log('Credentials written to:', tempCredentialsPath);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredentialsPath;
} catch (error) {
  console.error('Error writing credentials to temporary file:', error);
  throw error;
}

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/calendar.readonly']
});

const calendar = google.calendar({ version: 'v3', auth });
const LEADERSHIP_CALENDAR_ID = 'c_b297b4d19f4d0022e12fcc5722dabb4e95f0e04c98a100ee873b6fb02cb1b666@group.calendar.google.com';

app.post('/api/timeslots', async (req, res) => {
  const { date, room, duration } = req.body;

  if (!date || !room || !duration) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const timeMin = new Date(date + "T00:00:00").toISOString();
    const timeMax = new Date(date + "T23:59:59").toISOString();
    const response = await calendar.events.list({
      calendarId: LEADERSHIP_CALENDAR_ID,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const bookedSlots = response.data.items || [];
    const timeSlots = [
      "8:00 AM", "8:30 AM", "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM",
      "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM", "1:00 PM", "1:30 PM",
      "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM",
      "5:00 PM", "6:00 PM", "6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM"
    ];

    const availableSlots = timeSlots.filter(slot => {
      const slotStart = convertTimeSlotToISO(date, slot);
      const slotEnd = new Date(new Date(slotStart).getTime() + duration * 60000).toISOString();

      return !bookedSlots.some(event => {
        const eventStart = event.start.dateTime || event.start.date;
        const eventEnd = event.end.dateTime || event.end.date;
        const eventTitle = event.summary || "";
        const eventRoom = eventTitle.includes("Fayetteville") ? "fayetteville" : eventTitle.includes("Rogers") ? "rogers" : null;
        return slotStart < eventEnd && slotEnd > eventStart && eventRoom === room;
      });
    });

    res.json({ availableSlots });
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: 'Failed to fetch time slots' });
  }
});

function convertTimeSlotToISO(dateStr, timeStr) {
  const [time, period] = timeStr.split(" ");
  let [hours, minutes] = time.split(":").map(Number);
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  const date = new Date(`${dateStr}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`);
  return date.toISOString();
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
