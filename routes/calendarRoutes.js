const express = require('express');
const router = express.Router();
const CalendarDay = require('../models/CalendarDay');

// Get calendar data for a specific year
router.get('/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const calendarData = await CalendarDay.find({ year }).sort({ weekNumber: 1, date: 1 });
    res.json(calendarData);
  } catch (error) {
    console.error('Error fetching calendar data:', error);
    res.status(500).json({ message: 'Error fetching calendar data', error: error.message });
  }
});

// Save calendar data
router.post('/save', async (req, res) => {
  try {
    const { year, data } = req.body;

    if (!year || !data || !Array.isArray(data)) {
      return res.status(400).json({ message: 'Invalid data format' });
    }

    // Delete existing data for the year
    await CalendarDay.deleteMany({ year });

    // Insert new data
    const calendarDays = data.map(day => ({
      year: year,
      date: day.date,
      weekDay: day.weekDay,
      weekNumber: day.weekNumber,
      holidayName1: day.holidayName1 || '',
      specificDay1: day.specificDay1 || '',
      holidayName2: day.holidayName2 || '',
      specificDay2: day.specificDay2 || '',
      holidayName3: day.holidayName3 || '',
      specificDay3: day.specificDay3 || '',
      isOpen: day.isOpen !== undefined ? day.isOpen : true,
      closingHoursFrom: day.closingHoursFrom || '',
      closingHoursTo: day.closingHoursTo || '',
      notes: day.notes || ''
    }));

    await CalendarDay.insertMany(calendarDays);

    res.json({ message: 'Calendar data saved successfully', count: calendarDays.length });
  } catch (error) {
    console.error('Error saving calendar data:', error);
    res.status(500).json({ message: 'Error saving calendar data', error: error.message });
  }
});

// Update a single day
router.put('/day/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const updatedDay = await CalendarDay.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedDay) {
      return res.status(404).json({ message: 'Calendar day not found' });
    }

    res.json(updatedDay);
  } catch (error) {
    console.error('Error updating calendar day:', error);
    res.status(500).json({ message: 'Error updating calendar day', error: error.message });
  }
});

// Delete calendar data for a year
router.delete('/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const result = await CalendarDay.deleteMany({ year });
    res.json({ message: 'Calendar data deleted successfully', deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Error deleting calendar data:', error);
    res.status(500).json({ message: 'Error deleting calendar data', error: error.message });
  }
});

module.exports = router;
