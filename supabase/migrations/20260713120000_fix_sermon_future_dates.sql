-- Correct historical sermon dates imported with two-digit years as 20xx.
-- William Branham sermon library years in this range belong to 1950-1999.

update public.sermons
set preached_on = (preached_on - interval '100 years')::date
where preached_on >= date '2050-01-01'
  and preached_on < date '2100-01-01';

update public.sermons
set year = year - 100
where year >= 2050
  and year < 2100;
