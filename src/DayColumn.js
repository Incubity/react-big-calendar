import React from 'react';
import { findDOMNode } from 'react-dom';
import cn from 'classnames';

import Selection, { getBoundsForNode, isEvent } from './Selection';
import dates from './utils/dates';
import { isSelected } from './utils/selection';
import localizer from './localizer'

import { notify, dateIsInBusinessHours } from './utils/helpers';
import { accessor, elementType, dateFormat } from './utils/propTypes';
import { accessor as get } from './utils/accessors';

import getStyledEvents, { positionFromDate, startsBefore } from './utils/dayViewLayout'

import TimeColumn from './TimeColumn'

function snapToSlot(date, step){
  var roundTo = 1000 * 60 * step;
  return new Date(Math.floor(date.getTime() / roundTo) * roundTo)
}

function startsAfter(date, max) {
  return dates.gt(dates.merge(max, date), max, 'minutes')
}

let DaySlot = React.createClass({

  propTypes: {
    events: React.PropTypes.array.isRequired,
    step: React.PropTypes.number.isRequired,
    min: React.PropTypes.instanceOf(Date).isRequired,
    max: React.PropTypes.instanceOf(Date).isRequired,
    now: React.PropTypes.instanceOf(Date),

    rtl: React.PropTypes.bool,
    titleAccessor: accessor,
    allDayAccessor: accessor.isRequired,
    startAccessor: accessor.isRequired,
    endAccessor: accessor.isRequired,

    selectRangeFormat: dateFormat,
    eventTimeRangeFormat: dateFormat,
    culture: React.PropTypes.string,

    selected: React.PropTypes.object,
    selectable: React.PropTypes.oneOf([true, false, 'ignoreEvents']),
    eventOffset: React.PropTypes.number,

    onSelecting: React.PropTypes.func,
    onSelectSlot: React.PropTypes.func.isRequired,
    onSelectEvent: React.PropTypes.func.isRequired,

    className: React.PropTypes.string,
    dragThroughEvents: React.PropTypes.bool,
    eventPropGetter: React.PropTypes.func,
    dayWrapperComponent: elementType,
    eventComponent: elementType,
    eventWrapperComponent: elementType.isRequired,

    businessHours: React.PropTypes.array
  },

  getDefaultProps() {
    return { dragThroughEvents: true }
  },

  getInitialState() {
    return { selecting: false };
  },

  componentDidMount() {
    this.props.selectable
    && this._selectable()
  },

  componentWillUnmount() {
    this._teardownSelectable();
  },

  componentWillReceiveProps(nextProps) {
    if (nextProps.selectable && !this.props.selectable)
      this._selectable();
    if (!nextProps.selectable && this.props.selectable)
      this._teardownSelectable();
  },

  render() {
    const {
      min,
      max,
      step,
      now,
      selectRangeFormat,
      businessHours,
      culture,
      ...props
    } = this.props

    this._totalMin = dates.diff(min, max, 'minutes')

    let { selecting, startSlot, endSlot } = this.state
    let style = this._slotStyle(startSlot, endSlot)

    let selectDates = {
      start: this.state.startDate,
      end: this.state.endDate
    };

    return (
      <TimeColumn
        {...props}
        className={cn(
          'rbc-day-slot',
          dates.isToday(max) && 'rbc-today'
        )}
        now={now}
        businessHours={businessHours}
        min={min}
        max={max}
        step={step}
      >
        {this.renderEvents()}

        {selecting &&
          <div className='rbc-slot-selection' style={style}>
              <span>
              { localizer.format(selectDates, selectRangeFormat, culture) }
              </span>
          </div>
        }
      </TimeColumn>
    );
  },

  renderEvents() {
    let {
        events
      , min
      , max
      , culture
      , eventPropGetter
      , selected, eventTimeRangeFormat, eventComponent
      , eventWrapperComponent: EventWrapper
      , rtl: isRtl
      , step
      , startAccessor, endAccessor, titleAccessor } = this.props;

    let EventComponent = eventComponent

    let styledEvents = getStyledEvents({
      events, startAccessor, endAccessor, min, totalMin: this._totalMin, step
    })

    return styledEvents.map(({ event, style }, idx) => {
      let start = get(event, startAccessor)
      let end = get(event, endAccessor)

      let continuesPrior = startsBefore(start, min)
      let continuesAfter = startsAfter(end, max)

      let title = get(event, titleAccessor)
      let label = localizer.format({ start, end }, eventTimeRangeFormat, culture)
      let _isSelected = isSelected(event, selected)

      if (eventPropGetter)
        var { style: xStyle, className } = eventPropGetter(event, start, end, _isSelected)

      let { height, top, width, xOffset } = style

      return (
        <EventWrapper event={event} key={'evt_' + idx}>
          <div
            style={{
              ...xStyle,
              top: `${top}%`,
              height: `${height}%`,
              [isRtl ? 'right' : 'left']: `${Math.max(0, xOffset)}%`,
              width: `${width}%`
            }}
            title={label + ': ' + title }
            onClick={(e) => this._select(event, e)}
            className={cn('rbc-event', className, {
              'rbc-selected': _isSelected,
              'rbc-event-continues-earlier': continuesPrior,
              'rbc-event-continues-later': continuesAfter
            })}
          >
            <div className='rbc-event-label'>{label}</div>
            <div className='rbc-event-content'>
              { EventComponent
                ? <EventComponent event={event} title={title}/>
                : title
              }
            </div>
          </div>
        </EventWrapper>
      )
    })
  },

  _slotStyle(startSlot, endSlot) {
    let top = ((startSlot / this._totalMin) * 100);
    let bottom = ((endSlot / this._totalMin) * 100);

    return {
      top: top + '%',
      height: bottom - top + '%'
    }
  },

  _selectable(){
    let node = findDOMNode(this);
    let selector = this._selector = new Selection(()=> findDOMNode(this))

    let maybeSelect = (box) => {
      let { onSelecting, businessHours } = this.props
      let current = this.state || {};
      let state = selectionState(box);
      let { startDate: start, endDate: end } = state;

      // Return if there are business hours and the start date is not included
      if (businessHours.length > 0 && (!dateIsInBusinessHours(state.startDate, businessHours, true) || !dateIsInBusinessHours(state.endDate, businessHours, true))) {
        return
      }

      if (onSelecting) {
        if (
          (dates.eq(current.startDate, start, 'minutes') &&
          dates.eq(current.endDate, end, 'minutes')) ||
          onSelecting({ start, end }) === false
        )
          return
      }

      this.setState(state)
    }

    let selectionState = ({ y }) => {
      let { step, min, max } = this.props;
      let { top, bottom } = getBoundsForNode(node)

      let mins = this._totalMin;

      let range = Math.abs(top - bottom)

      let current = (y - top) / range;

      current = snapToSlot(minToDate(mins * current, min), step)

      if (!this.state.selecting)
        this._initialDateSlot = current

      let initial = this._initialDateSlot;

      if (dates.eq(initial, current, 'minutes'))
        current = dates.add(current, step, 'minutes')

      let start = dates.max(min, dates.min(initial, current))
      let end = dates.min(max, dates.max(initial, current))

      return {
        selecting: true,
        startDate: start,
        endDate: end,
        startSlot: positionFromDate(start, min, this._totalMin),
        endSlot: positionFromDate(end, min, this._totalMin)
      }
    }

    selector.on('selecting', maybeSelect)
    selector.on('selectStart', maybeSelect)

    selector.on('mousedown', (box) => {
      if (this.props.selectable !== 'ignoreEvents') return

      return !isEvent(findDOMNode(this), box)
    })

    selector
      .on('click', (box) => {
        if (!isEvent(findDOMNode(this), box))
          this._selectSlot(selectionState(box))

        this.setState({ selecting: false })
      })

    selector
      .on('select', () => {
        if (this.state.selecting) {
          this._selectSlot(this.state)
          this.setState({ selecting: false })
        }
      })
  },

  _teardownSelectable() {
    if (!this._selector) return
    this._selector.teardown();
    this._selector = null;
  },

  _selectSlot({ startDate, endDate }) {
    let current = startDate
      , slots = [];

    while (dates.lte(current, endDate)) {
      slots.push(current)
      current = dates.add(current, this.props.step, 'minutes')
    }

    notify(this.props.onSelectSlot, {
      slots,
      start: startDate,
      end: endDate
    })
  },

  _select(...args) {
    notify(this.props.onSelectEvent, args)
  }
});


function minToDate(min, date){
  var dt = new Date(date)
    , totalMins = dates.diff(dates.startOf(date, 'day'), date, 'minutes');

  dt = dates.hours(dt, 0);
  dt = dates.minutes(dt, totalMins + min);
  dt = dates.seconds(dt, 0)
  return dates.milliseconds(dt, 0)
}

export default DaySlot;
