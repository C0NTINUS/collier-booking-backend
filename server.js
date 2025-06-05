const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Log the environment variable to debug
console.log('GOOGLE_APPLICATION_CREDENTIALS_JSON:', process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

// Parse credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON
let credentials;
try {
  credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  console.log('Parsed credentials:', credentials);
} catch (error) {
  console.error('Error parsing GOOGLE_APPLICATION_CREDENTIALS_JSON:', error);
  throw error;
}

// Use credentials directly in OAuth2
const auth = new google.auth.OAuth2(
  credentials.client_id,
  credentials.client_secret,
  'https://localhost'
);

auth.setCredentials({
  refresh_token: credentials.refresh_token
});

const calendar = google.calendar({ version: 'v3', auth });
const LEADERSHIP_CALENDAR_ID = 'c_b297b4d19f4d0022e12fcc5722dabb4e95f0e04c98a100ee873b6fb02cb1b666@group.calendar.google.com';

// Endpoint to fetch available time slots
app.post('/api/timeslots', async (req, res) => {
  const { date, room, duration } = req.body;

  if (!date || !room || !duration) {
    console.log('Request missing required fields:', req.body);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const timeMin = new Date(date + "T00:00:00-05:00").toISOString();
    const timeMax = new Date(date + "T23:59:59-05:00").toISOString();
    console.log(`Fetching events for date ${date} from ${timeMin} to ${timeMax}`);
    const eventsResponse = await calendar.events.list({
      calendarId: LEADERSHIP_CALENDAR_ID,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const bookedSlots = eventsResponse.data.items || [];
    console.log('Booked slots:', bookedSlots.map(event => ({
      summary: event.summary,
      start: event.start.dateTime,
      end: event.end.dateTime,
      room: event.summary && event.summary.includes("Fayetteville") ? "fayetteville" : event.summary && event.summary.includes("Rogers") ? "rogers" : null
    })));

    const timeSlots = [
      "8:00 AM", "8:30 AM", "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM",
      "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM", "1:00 PM", "1:30 PM",
      "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM",
      "5:00 PM", "6:00 PM", "6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM"
    ];

    const availableSlots = timeSlots.filter(slot => {
      const slotStart = convertTimeSlotToISO(date, slot);
      const slotEnd = new Date(new Date(slotStart).getTime() + duration * 60000).toISOString();

      const isBooked = bookedSlots.some(event => {
        const eventStart = event.start.dateTime || event.start.date;
        const eventEnd = event.end.dateTime || event.end.date;
        const eventTitle = event.summary || "";
        const eventRoom = eventTitle.includes("Fayetteville") ? "fayetteville" : eventTitle.includes("Rogers") ? "rogers" : null;
        const overlap = slotStart < eventEnd && slotEnd > eventStart && eventRoom === room;
        console.log(`Checking slot ${slot} (${slotStart} to ${slotEnd}) against event "${eventTitle}" (${eventStart} to ${eventEnd}, room: ${eventRoom}, requested room: ${room}) - Overlap: ${overlap}`);
        return overlap;
      });

      if (isBooked) {
        console.log(`Slot ${slot} is booked and will be excluded.`);
      } else {
        console.log(`Slot ${slot} is available.`);
      }

      return !isBooked;
    });

    console.log('Available slots:', availableSlots);
    res.json({ availableSlots });
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: 'Failed to fetch time slots' });
  }
});

// Endpoint to book a time slot
app.post('/api/book', async (req, res) => {
  const { date, time, room, duration, agentName, email, description } = req.body;

  if (!date || !time || !room || !duration || !agentName || !email || !description) {
    console.log('Booking request missing required fields:', req.body);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check if the slot is already booked before creating the event
    const timeMin = new Date(date + "T00:00:00-05:00").toISOString();
    const timeMax = new Date(date + "T23:59:59-05:00").toISOString();
    const eventsResponse = await calendar.events.list({
      calendarId: LEADERSHIP_CALENDAR_ID,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const bookedSlots = eventsResponse.data.items || [];
    const slotStart = convertTimeSlotToISO(date, time);
    const slotEnd = new Date(new Date(slotStart).getTime() + duration * 60000).toISOString();

    const isSlotBooked = bookedSlots.some(event => {
      const eventStart = event.start.dateTime || event.start.date;
      const eventEnd = event.end.dateTime || event.end.date;
      const eventTitle = event.summary || "";
      const eventRoom = eventTitle.includes("Fayetteville") ? "fayetteville" : eventTitle.includes("Rogers") ? "rogers" : null;
      const overlap = slotStart < eventEnd && slotEnd > eventStart && eventRoom === room;
      if (overlap) {
        console.log(`Conflict detected: Slot ${time} on ${date} for ${room} overlaps with event "${eventTitle}" (${eventStart} to ${eventEnd})`);
      }
      return overlap;
    });

    if (isSlotBooked) {
      console.log(`Booking rejected: Slot ${time} on ${date} for ${room} is already taken.`);
      return res.status(409).json({ error: 'This time slot is already booked.' });
    }

    // Proceed with booking
    const startTime = convertTimeSlotToISO(date, time);
    const endTime = new Date(new Date(startTime).getTime() + duration * 60000).toISOString();

    const event = {
      summary: `Booking - ${room.charAt(0).toUpperCase() + room.slice(1)} Office - Agent: ${agentName} - ${description}`,
      description: `Agent: ${agentName}\nEmail: ${email}\nPurpose: ${description}`,
      start: {
        dateTime: startTime,
        timeZone: 'America/Chicago',
      },
      end: {
        dateTime: endTime,
        timeZone: 'America/Chicago',
      },
      attendees: [{ email }],
    };

    console.log('Creating event:', event);
    const insertResponse = await calendar.events.insert({
      calendarId: LEADERSHIP_CALENDAR_ID,
      resource: event,
    });

    console.log(`Event created successfully: ${insertResponse.data.id}`);
    res.json({ success: true, eventId: insertResponse.data.id });
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

function convertTimeSlotToISO(dateStr, timeStr) {
  const [time, period] = timeStr.split(" ");
  let [hours, minutes] = time.split(":").map(Number);
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  const date = new Date(`${dateStr}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00-05:00`);
  console.log(`Converted ${timeStr} on ${dateStr} to ISO: ${date.toISOString()}`);
  return date.toISOString();
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
