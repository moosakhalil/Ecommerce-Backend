const mongoose = require('mongoose');

const calendarDaySchema = new mongoose.Schema({
  year: {
    type: Number,
    required: true,
    index: true
  },
  date: {
    type: String,
    required: true
  },
  weekDay: {
    type: String,
    required: true
  },
  weekNumber: {
    type: Number,
    required: true
  },
  holidayName1: {
    type: String,
    default: ''
  },
  specificDay1: {
    type: String,
    default: ''
  },
  holidayName2: {
    type: String,
    default: ''
  },
  specificDay2: {
    type: String,
    default: ''
  },
  holidayName3: {
    type: String,
    default: ''
  },
  specificDay3: {
    type: String,
    default: ''
  },
  isOpen: {
    type: Boolean,
    default: true
  },
  closingHoursFrom: {
    type: String,
    default: ''
  },
  closingHoursTo: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Compound index for year and date
calendarDaySchema.index({ year: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('CalendarDay', calendarDaySchema);
