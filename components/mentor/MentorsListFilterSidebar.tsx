"use client";

import Link from "next/link";
import { useState } from "react";
import type { MentorsListFilters } from "@/lib/mentor/mentorsListSearchParams";
import {
  MENTOR_GRADE_OPTIONS,
  MENTOR_PRICE_BAND_OPTIONS,
  MENTOR_SCHOOL_OPTIONS,
  MENTOR_SUBJECT_OPTIONS,
  MENTOR_TYPE_OPTIONS,
  filtersToHrefRecord,
} from "@/lib/mentor/mentorsListSearchParams";
import type { MentorSchoolFilter, MentorTypeFilter } from "@/lib/mentor/mentorsListSearchParams";

type FilterOption<T extends string> = { id: T; label: string };

export function MentorsListFilterSidebar(props: {
  filters: MentorsListFilters;
  totalCount: number;
  className?: string;
  idPrefix?: string;
  schoolOptions?: FilterOption<MentorSchoolFilter>[];
  mentorTypeOptions?: FilterOption<MentorTypeFilter>[];
}) {
  const schoolOptions = props.schoolOptions ?? MENTOR_SCHOOL_OPTIONS;
  const mentorTypeOptions = props.mentorTypeOptions ?? MENTOR_TYPE_OPTIONS;
  const [extraSort, setExtraSort] = useState(
    props.filters.sort === "rating" || props.filters.sort === "response" ? props.filters.sort : "",
  );
  const [subjectOpen, setSubjectOpen] = useState(true);
  const [gradesOpen, setGradesOpen] = useState(true);
  const [priceOpen, setPriceOpen] = useState(false);

  const sortValue = extraSort || (props.filters.sort !== "popular" ? props.filters.sort : "");
  const filterKey = JSON.stringify(filtersToHrefRecord(props.filters));

  return (
    <div className={props.className ?? ""}>
      <form key={filterKey} method="get" action="/mentors" className="flex flex-col">
        <div className="max-h-[calc(100vh-12rem)] space-y-6 overflow-y-auto pr-1 lg:max-h-[calc(100vh-10rem)]">
          <input type="hidden" name="q" value={props.filters.q} />
          {props.filters.view === "grid" ? <input type="hidden" name="view" value="grid" /> : null}
          {sortValue ? <input type="hidden" name="sort" value={sortValue} /> : null}

          <fieldset>
            <button
              type="button"
              onClick={() => setSubjectOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
              aria-expanded={subjectOpen}
            >
              <span className="text-[12px] font-black text-slate-900">과목</span>
              <span className="text-xs font-black text-slate-500">{subjectOpen ? "▲" : "▼"}</span>
            </button>
            <div
              className={`mt-2 overflow-hidden transition-all duration-200 ease-in-out ${
                subjectOpen ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700">
                <input
                  type="radio"
                  name="subject"
                  value=""
                  defaultChecked={!props.filters.subject}
                  className="accent-[#2563EB]"
                />
                전체
              </label>
              {MENTOR_SUBJECT_OPTIONS.filter((o) => o.id !== "").map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700"
                >
                  <input
                    type="radio"
                    name="subject"
                    value={o.id}
                    defaultChecked={props.filters.subject === o.id}
                    className="accent-[#2563EB]"
                  />
                  {o.label}
                </label>
              ))}
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-[12px] font-black text-slate-900">학교군</legend>
            <div className="mt-2 space-y-2">
              {schoolOptions.map((o) => (
                <label
                  key={o.id || "all"}
                  className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700"
                >
                  <input
                    type="radio"
                    name="school"
                    value={o.id}
                    defaultChecked={props.filters.school === o.id}
                    className="accent-[#2563EB]"
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <button
              type="button"
              onClick={() => setGradesOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
              aria-expanded={gradesOpen}
            >
              <span className="text-[12px] font-black text-slate-900">대상 학년</span>
              <span className="text-xs font-black text-slate-500">{gradesOpen ? "▲" : "▼"}</span>
            </button>
            <div
              className={`mt-2 overflow-hidden transition-all duration-200 ease-in-out ${
                gradesOpen ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="space-y-2">
              {MENTOR_GRADE_OPTIONS.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700"
                >
                  <input
                    type="checkbox"
                    name="grades"
                    value={o.id}
                    defaultChecked={props.filters.grades.includes(o.id)}
                    className="accent-[#2563EB]"
                  />
                  {o.label}
                </label>
              ))}
              </div>
            </div>
          </fieldset>

          <fieldset>
            <button
              type="button"
              onClick={() => setPriceOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
              aria-expanded={priceOpen}
            >
              <span className="text-[12px] font-black text-slate-900">구독 요금</span>
              <span className="text-xs font-black text-slate-500">{priceOpen ? "▲" : "▼"}</span>
            </button>
            <div
              className={`mt-2 overflow-hidden transition-all duration-200 ease-in-out ${
                priceOpen ? "max-h-[560px] opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="space-y-2">
                {MENTOR_PRICE_BAND_OPTIONS.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700"
                  >
                    <input
                      type="radio"
                      name="priceBand"
                      value={o.id}
                      defaultChecked={props.filters.priceBand === o.id}
                      className="accent-[#2563EB]"
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-[12px] font-black text-slate-900">전공 계열</legend>
            <div className="mt-2 space-y-2">
              {mentorTypeOptions.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700"
                >
                  <input
                    type="checkbox"
                    name="mentorTypes"
                    value={o.id}
                    defaultChecked={props.filters.mentorTypes.includes(o.id)}
                    className="accent-[#2563EB]"
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-[12px] font-black text-slate-900">추가 필터</legend>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700">
                <input
                  type="radio"
                  name="sortExtra"
                  value="response"
                  checked={extraSort === "response"}
                  onChange={() => setExtraSort("response")}
                  className="accent-[#2563EB]"
                />
                답변 속도 빠른 순
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700">
                <input
                  type="radio"
                  name="sortExtra"
                  value="rating"
                  checked={extraSort === "rating"}
                  onChange={() => setExtraSort("rating")}
                  className="accent-[#2563EB]"
                />
                평점 높은 순
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700">
                <input
                  type="radio"
                  name="sortExtra"
                  value=""
                  checked={!extraSort}
                  onChange={() => setExtraSort("")}
                  className="accent-[#2563EB]"
                />
                기본 정렬 유지
              </label>
            </div>
          </fieldset>
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-100 bg-white pt-4">
          <button
            type="submit"
            className="min-h-[44px] w-full whitespace-nowrap rounded-xl bg-[#2563EB] px-4 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
          >
            검색 결과 보기
          </button>
          <Link
            href="/mentors"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-slate-800 hover:bg-slate-50"
          >
            초기화
          </Link>
        </div>
      </form>
    </div>
  );
}
