import SubgoalTable from './SubgoalTable';
import CompareTable from './CompareTable';

/** Tekniske tabeller under kartet (lastes bare når de åpnes). */
export default function TechDetails() {
  return (
    <>
      <SubgoalTable />
      <CompareTable />
    </>
  );
}
